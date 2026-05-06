// ============================================================
// telegram-bot.js (v13.2 - Simplified Single Message Format)
// 
// Features:
// - Single message for both PREDICTION and WAITING states
// - Shows previous prediction result (correct/wrong)
// - Clear retry count display
// - Clean, minimal format
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
     * Get previous prediction result text
     */
    getPreviousResultText() {
        if (!this.lastPredictionResult.predictedGroup) {
            return null;
        }
        
        const icon = this.lastPredictionResult.isCorrect === true ? '✅ CORRECT' : 
                     this.lastPredictionResult.isCorrect === false ? '❌ WRONG' : '⏳ PENDING';
        
        return `📜 Previous: ${this.lastPredictionResult.predictedGroup} → ${this.lastPredictionResult.actualGroup || '?'} ${icon}`;
    }
    
    /**
     * Update last prediction result
     */
    updateLastPredictionResult(predictedGroup, actualGroup, isCorrect, retryCount) {
        this.lastPredictionResult = {
            predictedGroup: predictedGroup,
            actualGroup: actualGroup,
            isCorrect: isCorrect,
            retryCount: retryCount || 0
        };
    }
    
    /**
     * Send prediction notification (SINGLE MESSAGE - ACTIVE MODE)
     */
    async sendPredictionNotification(prediction) {
        if (!this.isEnabled) return;
        
        // Rate limiting: don't send same prediction within 2 seconds
        const now = Date.now();
        if (this.lastNotification.type === 'prediction' && 
            this.lastNotification.predictedGroup === prediction.predictedGroup &&
            now - this.lastNotification.timestamp < 2000) {
            return;
        }
        
        this.lastNotification = {
            type: 'prediction',
            timestamp: now,
            predictedGroup: prediction.predictedGroup
        };
        
        const stats = prediction.stats;
        const retryCount = prediction.retryCount || 0;
        const isRetry = prediction.isRetry || false;
        
        // Get previous result text
        const previousText = this.getPreviousResultText();
        
        // Build status text
        let statusText = '🟢 ACTIVE';
        let retryDisplay = '';
        
        if (isRetry && retryCount > 0) {
            retryDisplay = `\n🔄 Retry #${retryCount}`;
        } else if (retryCount === 0) {
            retryDisplay = `\n🔄 Retry Count: 0`;
        }
        
        // Build the message
        let message = `🎯 NEXT PREDICTION: ${prediction.predictedGroup}
━━━━━━━━━━━━━━━━━━━━━`;

        if (previousText) {
            message += `\n${previousText}`;
        }
        
        message += `${retryDisplay}
⏳ Status: ${statusText}
💪 Confidence: ${prediction.confidence}%`;

        // Add frequencies summary
        if (stats) {
            message += `\n━━━━━━━━━━━━━━━━━━━━━
📊 ${stats.LOW.count} | ${stats.MEDIUM.count} | ${stats.HIGH.count}
🔴 LOW ${stats.LOW.percentage}%  🟡 MED ${stats.MEDIUM.percentage}%  🟢 HIGH ${stats.HIGH.percentage}%`;
        }
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: Prediction sent (${prediction.predictedGroup})`);
    }
    
    /**
     * Send WAITING notification (SINGLE MESSAGE - WAITING MODE)
     */
    async sendWaitingNotification(waitingData) {
        if (!this.isEnabled) return;
        
        // Rate limiting: don't send duplicate waiting notifications within 10 seconds
        const now = Date.now();
        if (this.lastNotification.type === 'waiting' && now - this.lastNotification.timestamp < 10000) {
            return;
        }
        
        this.lastNotification = {
            type: 'waiting',
            timestamp: now,
            predictedGroup: null
        };
        
        const stats = waitingData.stats;
        const retryCount = waitingData.retryCount || this.lastPredictionResult.retryCount || 0;
        
        // Determine waiting reason
        let waitingReasonText = '';
        if (waitingData.waitingReason === 'ALL_GROUPS_EQUAL') {
            waitingReasonText = '⚖️ All groups equal';
        } else if (waitingData.waitingReason === 'DUPLICATE_MEDIAN') {
            waitingReasonText = '🔄 Duplicate median';
        } else {
            waitingReasonText = '⏳ No unique median';
        }
        
        // Get previous result text
        const previousText = this.getPreviousResultText();
        
        // Build the message
        let message = `⏳ WAITING MODE
━━━━━━━━━━━━━━━━━━━━━`;

        if (previousText) {
            message += `\n${previousText}`;
        }
        
        message += `\n🔄 Retry Count: ${retryCount} (${retryCount >= 2 ? 'WAITING before retry #' + (retryCount + 1) : 'active'})
⏰ Reason: ${waitingReasonText}`;

        // Add frequencies
        if (stats) {
            const sorted = [stats.LOW.count, stats.MEDIUM.count, stats.HIGH.count].sort((a,b) => a-b);
            const median = sorted[1];
            
            message += `\n━━━━━━━━━━━━━━━━━━━━━
📊 ${stats.LOW.count} | ${stats.MEDIUM.count} | ${stats.HIGH.count}
🔴 LOW ${stats.LOW.percentage}%  🟡 MED ${stats.MEDIUM.percentage}%  🟢 HIGH ${stats.HIGH.percentage}%
📐 Median: ${median}`;
        }
        
        message += `\n━━━━━━━━━━━━━━━━━━━━━
⏰ Next prediction after 1 more result`;
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: WAITING notification sent (${waitingData.waitingReason})`);
    }
    
    /**
     * Send correct prediction notification (updates context)
     */
    async sendCorrectNotification(predictedGroup, actualGroup, retryCount) {
        if (!this.isEnabled) return;
        
        // Update stored last result
        this.updateLastPredictionResult(predictedGroup, actualGroup, true, retryCount);
        
        // Send concise correct message
        const message = `✅ CORRECT PREDICTION
━━━━━━━━━━━━━━━━━━━━━
🎯 ${predictedGroup} → ${actualGroup} ✓
🔄 Retry #${retryCount || 0}`;
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: CORRECT (${predictedGroup} → ${actualGroup})`);
    }
    
    /**
     * Send wrong prediction notification (updates context)
     */
    async sendWrongNotification(predictedGroup, actualGroup, retryCount) {
        if (!this.isEnabled) return;
        
        // Update stored last result
        this.updateLastPredictionResult(predictedGroup, actualGroup, false, retryCount);
        
        // Send concise wrong message
        const message = `❌ WRONG PREDICTION
━━━━━━━━━━━━━━━━━━━━━
🎯 ${predictedGroup} → ${actualGroup} ✗
🔄 Retry #${retryCount || 0}
⏳ Recalculating median...`;
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: WRONG (${predictedGroup} → ${actualGroup})`);
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
📌 Prediction: ${aiStatus.currentPrediction || 'None'}
🔄 Consecutive Wrong: ${convWrong}
━━━━━━━━━━━━━━━━━━━━━
📐 LOW: ${aiStatus.currentFrequencies?.LOW || 0}
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
    async sendStatsMessage(stats, last30Results) {
        if (!this.isEnabled) return;
        
        const sorted = [stats.LOW.count, stats.MEDIUM.count, stats.HIGH.count].sort((a,b) => a-b);
        const median = sorted[1];
        
        let medianGroup = '';
        if (stats.LOW.count === median) medianGroup = 'LOW';
        else if (stats.MEDIUM.count === median) medianGroup = 'MEDIUM';
        else medianGroup = 'HIGH';
        
        // Check if median is unique
        const isUnique = [stats.LOW.count, stats.MEDIUM.count, stats.HIGH.count].filter(c => c === median).length === 1;
        const uniqueText = isUnique ? `✅ UNIQUE → ${medianGroup}` : '⚠️ DUPLICATE (WAITING)';
        
        const message = `📊 LAST 30 STATISTICS
━━━━━━━━━━━━━━━━━━━━━
🔴 LOW: ${stats.LOW.count}/30 (${stats.LOW.percentage}%) ${stats.LOW.trend.emoji}
🟡 MEDIUM: ${stats.MEDIUM.count}/30 (${stats.MEDIUM.percentage}%) ${stats.MEDIUM.trend.emoji}
🟢 HIGH: ${stats.HIGH.count}/30 (${stats.HIGH.percentage}%) ${stats.HIGH.trend.emoji}
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
            const icon = p.isCorrect === true ? '✅' : (p.isCorrect === false ? '❌' : '⏳');
            const num = i + 1;
            historyText += `\n${num}. ${icon} ${p.predictedGroup} → ${p.actualGroup || '?'}`;
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
     * Get overall accuracy from history
     */
    getOverallAccuracy(predictions) {
        const correct = predictions.filter(p => p.isCorrect === true).length;
        const total = predictions.filter(p => p.isCorrect !== null).length;
        if (total === 0) return 0;
        return ((correct / total) * 100).toFixed(1);
    }
    
    /**
     * Get confidence stars
     */
    getConfidenceStars(confidence) {
        if (confidence >= 80) return '🌟🌟🌟🌟🌟';
        if (confidence >= 70) return '🌟🌟🌟🌟';
        if (confidence >= 60) return '🌟🌟🌟';
        if (confidence >= 50) return '🌟🌟';
        return '🌟';
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
        
        // First, delete webhook
        const webhookDeleted = await this.deleteWebhook();
        
        if (!webhookDeleted) {
            console.log('⚠️ Could not delete webhook, but continuing with polling...');
        }
        
        // Wait for webhook deletion
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test bot connection
        try {
            const testUrl = `https://api.telegram.org/bot${this.botToken}/getMe`;
            const response = await axios.get(testUrl, { timeout: 10000 });
            if (response.data && response.data.ok) {
                console.log(`✅ Bot connected: @${response.data.result.username}`);
            }
        } catch (error) {
            console.error('❌ Bot connection test failed:', error.message);
        }
        
        // Setup commands
        await this.setupBotCommands();
        
        // Start polling
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
            // Silently handle 409 errors
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
        // Fetch current data from API
        const data = await this.fetchAPI('/api/all-data');
        
        if (!data) {
            await this.sendMessageToChat(chatId, '⚠️ Unable to fetch data from server.');
            return;
        }
        
        switch(command) {
            case '/start':
                await this.sendStartMessage(chatId, data);
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
    async sendStartMessage(chatId, data) {
        const message = `⚡ Lightning Dice Predictor v13.2
🤖 Median-Based Statistical AI
━━━━━━━━━━━━━━━━━━━━━
📊 Analyzes last 30 results
📐 Predicts median group when UNIQUE
⏳ WAITING on duplicate/equal
━━━━━━━━━━━━━━━━━━━━━
📱 Commands:
/predict - Current prediction
/stats - 30-result statistics
/history - Last 10 predictions
/status - AI system status`;
        
        await this.sendMessageToChat(chatId, message);
    }
    
    /**
     * Send prediction command response
     */
    async sendPredictionCommand(chatId, data) {
        const prediction = data.currentPrediction;
        
        if (!prediction || prediction.status === 'WAITING' || prediction.waitingForData) {
            const stats = prediction?.stats;
            let message = `⏳ WAITING MODE
━━━━━━━━━━━━━━━━━━━━━`;
            
            const previousText = this.getPreviousResultText();
            if (previousText) {
                message += `\n${previousText}`;
            }
            
            if (stats) {
                message += `\n━━━━━━━━━━━━━━━━━━━━━
📊 ${stats.LOW.count} | ${stats.MEDIUM.count} | ${stats.HIGH.count}
🔴 LOW ${stats.LOW.percentage}%  🟡 MED ${stats.MEDIUM.percentage}%  🟢 HIGH ${stats.HIGH.percentage}%`;
            }
            
            message += `\n━━━━━━━━━━━━━━━━━━━━━
📐 Need ${Math.max(0, 30 - (data.last30Groups?.length || 0))} more results`;
            
            await this.sendMessageToChat(chatId, message);
            return;
        }
        
        const stats = prediction.stats;
        const retryCount = prediction.retryCount || 0;
        const previousText = this.getPreviousResultText();
        
        let message = `🎯 NEXT PREDICTION: ${prediction.predictedGroup}
━━━━━━━━━━━━━━━━━━━━━`;
        
        if (previousText) {
            message += `\n${previousText}`;
        }
        
        message += `\n🔄 Retry Count: ${retryCount}
⏳ Status: ACTIVE
💪 Confidence: ${prediction.confidence}%
━━━━━━━━━━━━━━━━━━━━━
📊 ${stats.LOW.count} | ${stats.MEDIUM.count} | ${stats.HIGH.count}
🔴 LOW ${stats.LOW.percentage}%  🟡 MED ${stats.MEDIUM.percentage}%  🟢 HIGH ${stats.HIGH.percentage}%`;
        
        await this.sendMessageToChat(chatId, message);
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
        
        const stats = prediction.stats;
        const sorted = [stats.LOW.count, stats.MEDIUM.count, stats.HIGH.count].sort((a,b) => a-b);
        const median = sorted[1];
        
        const message = `📊 LAST 30 STATISTICS
━━━━━━━━━━━━━━━━━━━━━
🔴 LOW: ${stats.LOW.count}/30 (${stats.LOW.percentage}%)
🟡 MEDIUM: ${stats.MEDIUM.count}/30 (${stats.MEDIUM.percentage}%)
🟢 HIGH: ${stats.HIGH.count}/30 (${stats.HIGH.percentage}%)
━━━━━━━━━━━━━━━━━━━━━
📐 Median: ${median}`;
        
        await this.sendMessageToChat(chatId, message);
    }
    
    /**
     * Send history command response
     */
    async sendHistoryCommand(chatId, data) {
        const predictions = data.predictions || [];
        
        if (predictions.length === 0) {
            await this.sendMessageToChat(chatId, '📜 No prediction history yet.');
            return;
        }
        
        const last10 = predictions.slice(0, 10);
        let historyText = '';
        
        for (let i = 0; i < last10.length; i++) {
            const p = last10[i];
            const icon = p.isCorrect === true ? '✅' : (p.isCorrect === false ? '❌' : '⏳');
            historyText += `\n${i+1}. ${icon} ${p.predictedGroup} → ${p.actualGroup || '?'}`;
        }
        
        const correct = predictions.filter(p => p.isCorrect === true).length;
        const total = predictions.filter(p => p.isCorrect !== null).length;
        const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : 0;
        
        const message = `📜 LAST 10 PREDICTIONS
━━━━━━━━━━━━━━━━━━━━━${historyText}
━━━━━━━━━━━━━━━━━━━━━
📊 Accuracy: ${accuracy}% (${correct}/${total})`;
        
        await this.sendMessageToChat(chatId, message);
    }
    
    /**
     * Send status command response
     */
    async sendStatusCommand(chatId, data) {
        const aiStats = data.aiStats || {};
        const prediction = data.currentPrediction;
        const aiStatus = data.aiStatus || {};
        
        const accuracy = aiStats.accuracy || 0;
        const totalPredictions = aiStats.total_predictions || 0;
        const correctPredictions = aiStats.correct_predictions || 0;
        const isActive = prediction && prediction.status !== 'WAITING';
        const convWrong = aiStatus.consecutiveWrongCount || 0;
        
        const message = `🤖 AI STATUS
━━━━━━━━━━━━━━━━━━━━━
📊 Total: ${totalPredictions} | ✅ ${correctPredictions}
📈 Accuracy: ${accuracy.toFixed(1)}%
━━━━━━━━━━━━━━━━━━━━━
🎯 Mode: ${isActive ? 'ACTIVE' : 'WAITING'}
📌 Prediction: ${prediction?.predictedGroup || 'None'}
🔄 Wrong Count: ${convWrong}`;
        
        await this.sendMessageToChat(chatId, message);
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
                // Reset stored context
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
