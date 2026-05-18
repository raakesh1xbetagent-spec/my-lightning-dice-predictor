// ============================================================
// telegram-bot.js (v14.0 - TRIPLE PREDICTOR FORMAT) - FIXED VERSION
// 
// Features:
// - Single message for RESULT & NEXT prediction (triple format)
// - Shows three predictors in one line
// - Clean, compact format
// - No duplicate retry display
// - FIXED: Added missing methods for server.js compatibility
// ============================================================

const axios = require('axios');
require('dotenv').config();

class TelegramBot {
    constructor(apiBaseUrl) {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.apiBaseUrl = apiBaseUrl || process.env.API_BASE_URL || 'http://localhost:3000';
        
        this.isEnabled = !!(this.botToken && this.chatId);
        this.lastUpdateId = 0;
        this.pollingInterval = null;
        this.pollingAttempts = 0;
        this.maxPollingAttempts = 3;
        
        // Store last prediction result for context
        this.lastPredictionResult = {
            predictedGroup: null,
            actualGroup: null,
            isCorrect: null,
            retryCount: 0
        };
        
        // Store last notification to avoid spam
        this.lastNotification = {
            type: null,
            timestamp: 0,
            predictedGroup: null
        };
        
        console.log(`🤖 Telegram Bot initialized: ${this.isEnabled ? 'ENABLED' : 'DISABLED (missing token/chatId)'}`);
        
        if (this.isEnabled) {
            console.log(`📱 Chat ID: ${this.chatId}`);
            console.log(`🌐 API Base URL: ${this.apiBaseUrl}`);
            console.log(`📊 Format: TRIPLE PREDICTOR v14.0`);
        }
    }
    
    /**
     * Check if bot is enabled
     */
    isEnabled() {
        return this.isEnabled;
    }
    
    /**
     * Setup bot commands via Telegram API with retry
     */
    async setupBotCommands(retryCount = 0) {
        if (!this.isEnabled) return;
        
        const commands = [
            { command: 'start', description: '🤖 Start bot & get current status' },
            { command: 'predict', description: '🎯 Get current AI prediction' },
            { command: 'stats', description: '📊 Show last 30 results statistics' },
            { command: 'history', description: '📜 Show last 10 prediction history' },
            { command: 'status', description: '🔍 Show AI system status' },
            { command: 'reset', description: '🔄 Reset AI state (admin only)' }
        ];
        
        try {
            const url = `https://api.telegram.org/bot${this.botToken}/setMyCommands`;
            await axios.post(url, { commands });
            console.log('✅ Telegram bot commands registered');
        } catch (error) {
            console.error(`❌ Failed to register commands (attempt ${retryCount + 1}):`, error.message);
            if (retryCount < 3) {
                setTimeout(() => this.setupBotCommands(retryCount + 1), 5000);
            }
        }
    }
    
    /**
     * Delete webhook with retry logic
     */
    async deleteWebhook(retryCount = 0) {
        if (!this.isEnabled) return false;
        
        try {
            const deleteUrl = `https://api.telegram.org/bot${this.botToken}/deleteWebhook`;
            const response = await axios.post(deleteUrl, { 
                drop_pending_updates: true 
            }, {
                timeout: 10000
            });
            
            if (response.data && response.data.ok) {
                console.log('✅ Webhook deleted successfully');
                return true;
            } else {
                console.log('⚠️ Webhook delete response:', response.data);
                return false;
            }
        } catch (error) {
            console.log(`⚠️ Webhook delete error (attempt ${retryCount + 1}):`, error.message);
            
            if (retryCount < 2) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.deleteWebhook(retryCount + 1);
            }
            return false;
        }
    }
    
    /**
     * Send message to Telegram
     */
    async sendMessage(text, parseMode = 'HTML') {
        if (!this.isEnabled) {
            return false;
        }
        
        try {
            const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
            await axios.post(url, {
                chat_id: this.chatId,
                text: text,
                parse_mode: parseMode,
                disable_web_page_preview: true
            }, {
                timeout: 10000
            });
            return true;
        } catch (error) {
            console.error('❌ Telegram send error:', error.message);
            return false;
        }
    }
    
    /**
     * Get group icon
     */
    getGroupIcon(group) {
        if (group === 'LOW') return '🔴';
        if (group === 'MEDIUM') return '🟡';
        if (group === 'HIGH') return '🟢';
        return '⚪';
    }
    
    /**
     * Get result icon
     */
    getResultIcon(isCorrect) {
        if (isCorrect === true) return '✅';
        if (isCorrect === false) return '❌';
        return '⏳';
    }
    
    // ============================================================
    // NEW METHODS ADDED FOR server.js COMPATIBILITY
    // ============================================================
    
    /**
     * Send prediction notification (called from server.js)
     */
    async sendPredictionNotification(predictionData) {
        if (!this.isEnabled) return;
        
        // Rate limiting
        const now = Date.now();
        const predictedGroup = predictionData?.median?.predictedGroup;
        if (this.lastNotification.type === 'prediction' && 
            this.lastNotification.predictedGroup === predictedGroup &&
            now - this.lastNotification.timestamp < 2000) {
            return;
        }
        
        this.lastNotification = {
            type: 'prediction',
            timestamp: now,
            predictedGroup: predictedGroup
        };
        
        const frequencies = predictionData?.stats;
        await this.sendTriplePredictionNotification(predictionData, {
            LOW: frequencies?.LOW?.count || 0,
            MEDIUM: frequencies?.MEDIUM?.count || 0,
            HIGH: frequencies?.HIGH?.count || 0
        });
    }
    
    /**
     * Send waiting notification (called from server.js)
     */
    async sendWaitingNotification(waitingData) {
        if (!this.isEnabled) return;
        
        // Rate limiting
        const now = Date.now();
        if (this.lastNotification.type === 'waiting' && now - this.lastNotification.timestamp < 10000) {
            return;
        }
        
        this.lastNotification = {
            type: 'waiting',
            timestamp: now,
            predictedGroup: null
        };
        
        const frequencies = waitingData?.stats;
        await this.sendTripleWaitingNotification(waitingData, {
            LOW: frequencies?.LOW?.count || 0,
            MEDIUM: frequencies?.MEDIUM?.count || 0,
            HIGH: frequencies?.HIGH?.count || 0
        });
    }
    
    /**
     * Send correct notification for triple predictors (called from server.js)
     */
    async sendTripleCorrectNotification(predictedGroups, actualGroup, retryCount) {
        if (!this.isEnabled) return;
        
        // Rate limiting
        const now = Date.now();
        if (this.lastNotification.type === 'correct' && now - this.lastNotification.timestamp < 3000) {
            return;
        }
        
        this.lastNotification = {
            type: 'correct',
            timestamp: now,
            predictedGroup: predictedGroups.median
        };
        
        const medianIcon = this.getGroupIcon(predictedGroups.median);
        const highVolIcon = this.getGroupIcon(predictedGroups.highVolume);
        const lowVolIcon = this.getGroupIcon(predictedGroups.lowVolume);
        const actualIcon = this.getGroupIcon(actualGroup);
        
        const message = `✅ TRIPLE PREDICTOR - CORRECT!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📐 MEDIAN: ${medianIcon} ${predictedGroups.median} → ${actualIcon} ${actualGroup} ✓
📈 HIGH-VOL: ${highVolIcon} ${predictedGroups.highVolume} → ${actualIcon} ${actualGroup} ✓
📉 LOW-VOL: ${lowVolIcon} ${predictedGroups.lowVolume} → ${actualIcon} ${actualGroup} ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 Shared Retry Count: ${retryCount || 0}`;
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: Triple correct notification sent (${predictedGroups.median}→${actualGroup})`);
    }
    
    /**
     * Send wrong notification for triple predictors (called from server.js)
     */
    async sendTripleWrongNotification(predictedGroups, actualGroup, retryCount) {
        if (!this.isEnabled) return;
        
        // Rate limiting
        const now = Date.now();
        if (this.lastNotification.type === 'wrong' && now - this.lastNotification.timestamp < 3000) {
            return;
        }
        
        this.lastNotification = {
            type: 'wrong',
            timestamp: now,
            predictedGroup: predictedGroups.median
        };
        
        const medianIcon = this.getGroupIcon(predictedGroups.median);
        const highVolIcon = this.getGroupIcon(predictedGroups.highVolume);
        const lowVolIcon = this.getGroupIcon(predictedGroups.lowVolume);
        const actualIcon = this.getGroupIcon(actualGroup);
        
        const medianStatus = predictedGroups.median === actualGroup ? '✓' : '✗';
        const highVolStatus = predictedGroups.highVolume === actualGroup ? '✓' : '✗';
        const lowVolStatus = predictedGroups.lowVolume === actualGroup ? '✓' : '✗';
        
        const message = `❌ TRIPLE PREDICTOR - WRONG!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📐 MEDIAN: ${medianIcon} ${predictedGroups.median} → ${actualIcon} ${actualGroup} ${medianStatus}
📈 HIGH-VOL: ${highVolIcon} ${predictedGroups.highVolume} → ${actualIcon} ${actualGroup} ${highVolStatus}
📉 LOW-VOL: ${lowVolIcon} ${predictedGroups.lowVolume} → ${actualIcon} ${actualGroup} ${lowVolStatus}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 Next Retry: #${retryCount}`;
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: Triple wrong notification sent (${predictedGroups.median}→${actualGroup})`);
    }
    
    // ============================================================
    // EXISTING METHODS (KEPT AS IS)
    // ============================================================
    
    /**
     * Send TRIPLE PREDICTOR result & next notification (MAIN METHOD)
     * This sends ONE message with both result and next prediction
     */
    async sendTripleResultNotification(predictionData, actualGroup, isMedianCorrect, isHighVolCorrect, isLowVolCorrect, frequencies) {
        if (!this.isEnabled) return;
        
        // Rate limiting
        const now = Date.now();
        if (this.lastNotification.type === 'result' && now - this.lastNotification.timestamp < 3000) {
            return;
        }
        
        this.lastNotification = {
            type: 'result',
            timestamp: now,
            predictedGroup: predictionData?.median?.predictedGroup || null
        };
        
        // Get prediction data
        const median = predictionData?.median;
        const highVolume = predictionData?.highVolume;
        const lowVolume = predictionData?.lowVolume;
        
        const medianPredicted = median?.predictedGroup || '?';
        const highVolPredicted = highVolume?.predictedGroup || '?';
        const lowVolPredicted = lowVolume?.predictedGroup || '?';
        
        const medianConfidence = median?.confidence || 0;
        const highVolConfidence = highVolume?.confidence || 0;
        const lowVolConfidence = lowVolume?.confidence || 0;
        
        const medianIcon = this.getGroupIcon(medianPredicted);
        const highVolIcon = this.getGroupIcon(highVolPredicted);
        const lowVolIcon = this.getGroupIcon(lowVolPredicted);
        
        const actualIcon = this.getGroupIcon(actualGroup);
        
        // Build the message
        let message = `📊 TRIPLE PREDICTOR - RESULT & NEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📐 MEDIAN: ${medianIcon} ${medianPredicted} → ${actualIcon} ${actualGroup} ${this.getResultIcon(isMedianCorrect)} | NEXT: ${medianIcon} ${medianPredicted}(${medianConfidence}%)
📈 HIGH-VOL: ${highVolIcon} ${highVolPredicted} → ${actualIcon} ${actualGroup} ${this.getResultIcon(isHighVolCorrect)} | NEXT: ${highVolIcon} ${highVolPredicted}(${highVolConfidence}%)
📉 LOW-VOL: ${lowVolIcon} ${lowVolPredicted} → ${actualIcon} ${actualGroup} ${this.getResultIcon(isLowVolCorrect)} | NEXT: ${lowVolIcon} ${lowVolPredicted}(${lowVolConfidence}%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 LOW=${frequencies?.LOW || 0} | MED=${frequencies?.MEDIUM || 0} | HIGH=${frequencies?.HIGH || 0}`;
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: Triple result sent (${medianPredicted}→${actualGroup})`);
    }
    
    /**
     * Send TRIPLE PREDICTOR waiting notification
     */
    async sendTripleWaitingNotification(waitingData, frequencies) {
        if (!this.isEnabled) return;
        
        // Rate limiting
        const now = Date.now();
        if (this.lastNotification.type === 'waiting' && now - this.lastNotification.timestamp < 10000) {
            return;
        }
        
        this.lastNotification = {
            type: 'waiting',
            timestamp: now,
            predictedGroup: null
        };
        
        let waitingReasonText = '';
        if (waitingData.waitingReason === 'ALL_GROUPS_EQUAL') {
            waitingReasonText = 'All groups equal';
        } else if (waitingData.waitingReason === 'DUPLICATE_MEDIAN') {
            waitingReasonText = 'Duplicate median';
        } else {
            waitingReasonText = 'No unique median';
        }
        
        let message = `📊 TRIPLE PREDICTOR - WAITING MODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📐 MEDIAN: ⏳ WAITING
📈 HIGH-VOL: ⏳ WAITING
📉 LOW-VOL: ⏳ WAITING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ Reason: ${waitingReasonText}
📊 LOW=${frequencies?.LOW || 0} | MED=${frequencies?.MEDIUM || 0} | HIGH=${frequencies?.HIGH || 0}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏳ Next prediction after 1 more result`;
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: Triple waiting sent (${waitingData.waitingReason})`);
    }
    
    /**
     * Send TRIPLE PREDICTOR active prediction notification (without result)
     */
    async sendTriplePredictionNotification(predictionData, frequencies) {
        if (!this.isEnabled) return;
        
        // Rate limiting
        const now = Date.now();
        const predictedGroup = predictionData?.median?.predictedGroup;
        if (this.lastNotification.type === 'prediction' && 
            this.lastNotification.predictedGroup === predictedGroup &&
            now - this.lastNotification.timestamp < 2000) {
            return;
        }
        
        this.lastNotification = {
            type: 'prediction',
            timestamp: now,
            predictedGroup: predictedGroup
        };
        
        const median = predictionData?.median;
        const highVolume = predictionData?.highVolume;
        const lowVolume = predictionData?.lowVolume;
        
        const medianPredicted = median?.predictedGroup || '?';
        const highVolPredicted = highVolume?.predictedGroup || '?';
        const lowVolPredicted = lowVolume?.predictedGroup || '?';
        
        const medianConfidence = median?.confidence || 0;
        const highVolConfidence = highVolume?.confidence || 0;
        const lowVolConfidence = lowVolume?.confidence || 0;
        
        const medianIcon = this.getGroupIcon(medianPredicted);
        const highVolIcon = this.getGroupIcon(highVolPredicted);
        const lowVolIcon = this.getGroupIcon(lowVolPredicted);
        
        let message = `📊 TRIPLE PREDICTOR - ACTIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📐 MEDIAN: ${medianIcon} ${medianPredicted} (${medianConfidence}%)
📈 HIGH-VOL: ${highVolIcon} ${highVolPredicted} (${highVolConfidence}%)
📉 LOW-VOL: ${lowVolIcon} ${lowVolPredicted} (${lowVolConfidence}%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 LOW=${frequencies?.LOW || 0} | MED=${frequencies?.MEDIUM || 0} | HIGH=${frequencies?.HIGH || 0}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏳ Waiting for next result...`;
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: Triple prediction sent (${medianPredicted})`);
    }
    
    /**
     * Send status message (for /status command)
     */
    async sendStatusMessage(aiStatus, prediction) {
        if (!this.isEnabled) return;
        
        const activeText = aiStatus.isActive ? '🟢 ACTIVE' : '⚪ WAITING';
        const accuracyText = aiStatus.accuracy ? `${aiStatus.accuracy.toFixed(1)}%` : 'N/A';
        const convWrong = aiStatus.consecutiveWrongCount || 0;
        
        let message = `🤖 AI STATUS
━━━━━━━━━━━━━━━━━━━━━
📊 Total: ${aiStatus.totalPredictions || 0} | ✅ ${aiStatus.correctPredictions || 0}
📈 Accuracy: ${accuracyText}
━━━━━━━━━━━━━━━━━━━━━
🎯 Mode: ${activeText}
🔄 Consecutive Wrong: ${convWrong}
━━━━━━━━━━━━━━━━━━━━━
📊 LOW: ${aiStatus.currentFrequencies?.LOW || 0}
🟡 MEDIUM: ${aiStatus.currentFrequencies?.MEDIUM || 0}
🟢 HIGH: ${aiStatus.currentFrequencies?.HIGH || 0}`;
        
        if (aiStatus.waitingReason) {
            message += `\n⚠️ ${aiStatus.waitingReason}`;
        }
        
        await this.sendMessage(message);
    }
    
    /**
     * Send stats message (for /stats command)
     */
    async sendStatsMessage(stats) {
        if (!this.isEnabled) return;
        
        const sorted = [stats.LOW.count, stats.MEDIUM.count, stats.HIGH.count].sort((a,b) => a-b);
        const median = sorted[1];
        
        let medianGroup = '';
        if (stats.LOW.count === median) medianGroup = 'LOW';
        else if (stats.MEDIUM.count === median) medianGroup = 'MEDIUM';
        else medianGroup = 'HIGH';
        
        const isUnique = [stats.LOW.count, stats.MEDIUM.count, stats.HIGH.count].filter(c => c === median).length === 1;
        const uniqueText = isUnique ? `✅ UNIQUE → ${medianGroup}` : '⚠️ DUPLICATE (WAITING)';
        
        const message = `📊 LAST 10 STATISTICS
━━━━━━━━━━━━━━━━━━━━━
🔴 LOW: ${stats.LOW.count}/10 (${stats.LOW.percentage}%) ${stats.LOW.trend?.emoji || '⚖️'}
🟡 MEDIUM: ${stats.MEDIUM.count}/10 (${stats.MEDIUM.percentage}%) ${stats.MEDIUM.trend?.emoji || '⚖️'}
🟢 HIGH: ${stats.HIGH.count}/10 (${stats.HIGH.percentage}%) ${stats.HIGH.trend?.emoji || '⚖️'}
━━━━━━━━━━━━━━━━━━━━━
📐 Median: ${median} → ${uniqueText}`;
        
        await this.sendMessage(message);
    }
    
    /**
     * Send history message (for /history command)
     */
    async sendHistoryMessage(predictions) {
        if (!this.isEnabled) return;
        
        if (!predictions || predictions.length === 0) {
            await this.sendMessage('📜 No prediction history yet.');
            return;
        }
        
        const last10 = predictions.slice(0, 10);
        let historyText = '';
        
        for (let i = 0; i < last10.length; i++) {
            const p = last10[i];
            historyText += `\n${i+1}. ${p.predictedGroup} → ${p.actualGroup || '?'} ${p.isCorrect === true ? '✅' : (p.isCorrect === false ? '❌' : '⏳')}`;
        }
        
        const correct = predictions.filter(p => p.isCorrect === true).length;
        const total = predictions.filter(p => p.isCorrect !== null).length;
        const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : 0;
        
        const message = `📜 LAST 10 PREDICTIONS
━━━━━━━━━━━━━━━━━━━━━${historyText}
━━━━━━━━━━━━━━━━━━━━━
📊 Accuracy: ${accuracy}% (${correct}/${total})`;
        
        await this.sendMessage(message);
    }
    
    /**
     * Start polling for user commands
     */
    async startPolling() {
        if (!this.isEnabled) {
            console.log('⚠️ Telegram bot not enabled, skipping polling');
            return;
        }
        
        console.log('🔄 Setting up Telegram bot polling...');
        
        const webhookDeleted = await this.deleteWebhook();
        
        if (!webhookDeleted) {
            console.log('⚠️ Could not delete webhook, but continuing with polling...');
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
            const testUrl = `https://api.telegram.org/bot${this.botToken}/getMe`;
            const response = await axios.get(testUrl, { timeout: 10000 });
            if (response.data && response.data.ok) {
                console.log(`✅ Bot connected: @${response.data.result.username}`);
            }
        } catch (error) {
            console.error('❌ Bot connection test failed:', error.message);
        }
        
        await this.setupBotCommands();
        
        this.pollingInterval = setInterval(async () => {
            await this.pollUpdates();
        }, 5000);
        
        console.log('✅ Telegram bot polling started (interval: 5s)');
    }
    
    /**
     * Poll for updates from Telegram
     */
    async pollUpdates() {
        if (!this.isEnabled) return;
        
        try {
            const url = `https://api.telegram.org/bot${this.botToken}/getUpdates`;
            const response = await axios.get(url, {
                params: {
                    offset: this.lastUpdateId + 1,
                    timeout: 30,
                    allowed_updates: ['message']
                },
                timeout: 15000
            });
            
            if (response.data && response.data.ok) {
                const updates = response.data.result;
                
                for (const update of updates) {
                    if (update.update_id > this.lastUpdateId) {
                        this.lastUpdateId = update.update_id;
                    }
                    
                    if (update.message && update.message.text) {
                        const chatId = update.message.chat.id;
                        const text = update.message.text.trim();
                        const command = text.toLowerCase();
                        
                        await this.handleCommand(command, chatId);
                    }
                }
            }
        } catch (error) {
            if (error.response?.status === 409) {
                // Normal polling conflict, ignore
            } else if (error.response?.status === 404) {
                console.error('❌ Bot token invalid');
                this.isEnabled = false;
                this.stopPolling();
            } else if (Math.random() < 0.05) {
                console.error('Polling error:', error.message);
            }
        }
    }
    
    /**
     * Handle user commands
     */
    async handleCommand(command, chatId) {
        const data = await this.fetchAPI('/api/all-data');
        
        if (!data) {
            await this.sendMessageToChat(chatId, '⚠️ Unable to fetch data from server.');
            return;
        }
        
        switch(command) {
            case '/start':
                await this.sendStartMessage(chatId);
                break;
            case '/predict':
                await this.sendPredictionCommand(chatId, data);
                break;
            case '/stats':
                await this.sendStatsCommand(chatId, data);
                break;
            case '/history':
                await this.sendHistoryCommand(chatId, data);
                break;
            case '/status':
                await this.sendStatusCommand(chatId, data);
                break;
            case '/reset':
                await this.handleReset(chatId);
                break;
            default:
                if (command.startsWith('/')) {
                    await this.sendMessageToChat(chatId, `❓ Unknown: ${command}\nCommands: /predict, /stats, /history, /status`);
                }
        }
    }
    
    /**
     * Send message to specific chat
     */
    async sendMessageToChat(chatId, text, parseMode = 'HTML') {
        try {
            const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
            await axios.post(url, {
                chat_id: chatId,
                text: text,
                parse_mode: parseMode
            }, {
                timeout: 10000
            });
        } catch (error) {
            console.error('Error sending message:', error.message);
        }
    }
    
    /**
     * Fetch API data
     */
    async fetchAPI(endpoint) {
        try {
            const response = await axios.get(`${this.apiBaseUrl}${endpoint}`, {
                timeout: 8000
            });
            return response.data;
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Send start message
     */
    async sendStartMessage(chatId) {
        const message = `⚡ Lightning Dice Predictor v14.0
🤖 TRIPLE PREDICTOR STATISTICAL AI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 THREE PREDICTORS:
📐 MEDIAN - Middle value group
📈 HIGH-VOL - Most frequent group
📉 LOW-VOL - Least frequent group
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 Commands:
/predict - Current prediction
/stats - 10-result statistics
/history - Last 10 predictions
/status - AI system status
/reset - Reset AI (admin)`;
        
        await this.sendMessageToChat(chatId, message);
    }
    
    /**
     * Send prediction command response
     */
    async sendPredictionCommand(chatId, data) {
        const prediction = data.currentPrediction;
        
        if (!prediction || prediction.status === 'WAITING' || prediction.waitingForData) {
            const stats = prediction?.stats;
            const frequencies = {
                LOW: stats?.LOW?.count || 0,
                MEDIUM: stats?.MEDIUM?.count || 0,
                HIGH: stats?.HIGH?.count || 0
            };
            await this.sendTripleWaitingNotification(prediction, frequencies);
            return;
        }
        
        const frequencies = {
            LOW: prediction.stats?.LOW?.count || 0,
            MEDIUM: prediction.stats?.MEDIUM?.count || 0,
            HIGH: prediction.stats?.HIGH?.count || 0
        };
        
        await this.sendTriplePredictionNotification(prediction, frequencies);
    }
    
    /**
     * Send stats command response
     */
    async sendStatsCommand(chatId, data) {
        const prediction = data.currentPrediction;
        
        if (!prediction || !prediction.stats) {
            await this.sendMessageToChat(chatId, '⚠️ No statistics available yet.');
            return;
        }
        
        await this.sendStatsMessage(prediction.stats);
    }
    
    /**
     * Send history command response
     */
    async sendHistoryCommand(chatId, data) {
        const predictions = data.predictions || [];
        await this.sendHistoryMessage(predictions);
    }
    
    /**
     * Send status command response
     */
    async sendStatusCommand(chatId, data) {
        const aiStatus = data.aiStatus || {};
        const prediction = data.currentPrediction;
        await this.sendStatusMessage(aiStatus, prediction);
    }
    
    /**
     * Handle reset command
     */
    async handleReset(chatId) {
        try {
            const response = await axios.post(`${this.apiBaseUrl}/api/reset-ai`, {}, {
                timeout: 10000
            });
            if (response.data && response.data.success) {
                this.lastPredictionResult = {
                    predictedGroup: null,
                    actualGroup: null,
                    isCorrect: null,
                    retryCount: 0
                };
                await this.sendMessageToChat(chatId, '🔄 AI reset to WAITING mode.');
            } else {
                await this.sendMessageToChat(chatId, '⚠️ Failed to reset AI.');
            }
        } catch (error) {
            await this.sendMessageToChat(chatId, '⚠️ Error resetting AI.');
        }
    }
    
    /**
     * Stop polling
     */
    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            console.log('🛑 Telegram bot polling stopped');
        }
    }
}

module.exports = TelegramBot;
