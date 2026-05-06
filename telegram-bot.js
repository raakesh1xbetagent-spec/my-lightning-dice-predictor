// ============================================================
// telegram-bot.js (v13.1 - Fixed Railway Polling)
// 
// Features:
// - Send notifications for PREDICTION, WAITING, CORRECT, WRONG
// - Support commands: /start, /predict, /stats, /history, /status
// - Fixed 409 error handling for Railway deployment
// - Proper webhook cleanup with retry logic
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
        
        // Store last notification to avoid spam
        this.lastNotification = {
            type: null,
            timestamp: 0,
            predictedGroup: null
        };
        
        console.log(`🤖 Telegram Bot initialized: ${this.isEnabled ? 'ENABLED' : 'DISABLED (missing token/chatId)'}`);
        
        if (this.isEnabled) {
            // Don't call setupBotCommands immediately, wait for startPolling
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
            { command: 'predict', description: '🎯 Get current AI prediction (or WAITING status)' },
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
            console.log('⚠️ Telegram not configured, skipping message');
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
     * Send prediction notification
     */
    async sendPredictionNotification(prediction) {
        if (!this.isEnabled) return;
        
        // Rate limiting: don't send same prediction within 2 seconds
        const now = Date.now();
        if (this.lastNotification.type === 'prediction' && 
            this.lastNotification.predictedGroup === prediction.predictedGroup &&
            now - this.lastNotification.timestamp < 2000) {
            console.log('⏭️ Skipping duplicate prediction notification');
            return;
        }
        
        this.lastNotification = {
            type: 'prediction',
            timestamp: now,
            predictedGroup: prediction.predictedGroup
        };
        
        const stats = prediction.stats;
        const retryText = prediction.isRetry ? `\n🔄 RETRY #${prediction.retryCount + 1}` : '';
        const confidenceStar = this.getConfidenceStars(prediction.confidence);
        
        const message = `
🎯 <b>NEW PREDICTION</b>${retryText}
━━━━━━━━━━━━━━━━━━━━━

📊 <b>Last 30 Results Statistics:</b>
🔴 <b>LOW</b> (3-9)     → ${stats.LOW.percentage}% (${stats.LOW.count}/30) ${stats.LOW.trend.emoji}
🟡 <b>MEDIUM</b> (10-11) → ${stats.MEDIUM.percentage}% (${stats.MEDIUM.count}/30) ${stats.MEDIUM.trend.emoji}
🟢 <b>HIGH</b> (12-18)   → ${stats.HIGH.percentage}% (${stats.HIGH.count}/30) ${stats.HIGH.trend.emoji}

━━━━━━━━━━━━━━━━━━━━━
📐 <b>Median Analysis:</b>
Median Value: <code>${prediction.medianValue}</code> occurrences
Median Group: <b>${prediction.medianGroup}</b>

━━━━━━━━━━━━━━━━━━━━━
🎯 <b>AI PREDICTION:</b> <b>${prediction.predictedGroup}</b>
💪 <b>Confidence:</b> ${prediction.confidence}% ${confidenceStar}

${prediction.message}
        `.trim();
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: Prediction notification sent (${prediction.predictedGroup})`);
    }
    
    /**
     * Send WAITING notification
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
        let waitingReasonText = '';
        
        if (waitingData.waitingReason === 'ALL_GROUPS_EQUAL') {
            waitingReasonText = '⚖️ All three groups have EQUAL frequency';
        } else if (waitingData.waitingReason === 'DUPLICATE_MEDIAN') {
            waitingReasonText = '🔄 Median value appears in MULTIPLE groups';
        } else {
            waitingReasonText = '⏳ Waiting for unique median condition';
        }
        
        const message = `
⏳ <b>WAITING MODE</b>
━━━━━━━━━━━━━━━━━━━━━

📊 <b>Last 30 Results Statistics:</b>
🔴 <b>LOW</b> (3-9)     → ${stats.LOW.percentage}% (${stats.LOW.count}/30) ${stats.LOW.trend.emoji}
🟡 <b>MEDIUM</b> (10-11) → ${stats.MEDIUM.percentage}% (${stats.MEDIUM.count}/30) ${stats.MEDIUM.trend.emoji}
🟢 <b>HIGH</b> (12-18)   → ${stats.HIGH.percentage}% (${stats.HIGH.count}/30) ${stats.HIGH.trend.emoji}

━━━━━━━━━━━━━━━━━━━━━
⚠️ <b>Reason:</b> ${waitingReasonText}

📐 <b>Median Calculation:</b>
<code>${waitingData.medianResult?.sorted?.[0]?.count || '?'} → ${waitingData.medianResult?.sorted?.[1]?.count || '?'} → ${waitingData.medianResult?.sorted?.[2]?.count || '?'}</code>

⏰ Waiting for next result to break the tie...
        `.trim();
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: WAITING notification sent (${waitingData.waitingReason})`);
    }
    
    /**
     * Send correct prediction notification
     */
    async sendCorrectNotification(predictedGroup, actualGroup, retryCount) {
        if (!this.isEnabled) return;
        
        const retryText = retryCount > 0 ? ` (Correct after ${retryCount} retries)` : '';
        const message = `
✅ <b>CORRECT PREDICTION</b>${retryText}
━━━━━━━━━━━━━━━━━━━━━

🎯 Predicted: <b>${predictedGroup}</b>
🎲 Actual: <b>${actualGroup}</b>

✨ Prediction was ACCURATE!
        `.trim();
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: CORRECT notification sent (${predictedGroup} → ${actualGroup})`);
    }
    
    /**
     * Send wrong prediction notification
     */
    async sendWrongNotification(predictedGroup, actualGroup, retryCount) {
        if (!this.isEnabled) return;
        
        const retryText = retryCount > 0 ? ` (Retry #${retryCount})` : '';
        const message = `
❌ <b>WRONG PREDICTION</b>${retryText}
━━━━━━━━━━━━━━━━━━━━━

🎯 Predicted: <b>${predictedGroup}</b>
🎲 Actual: <b>${actualGroup}</b>

⚠️ AI will recalculate median with updated data...
        `.trim();
        
        await this.sendMessage(message);
        console.log(`📱 Telegram: WRONG notification sent (${predictedGroup} → ${actualGroup})`);
    }
    
    /**
     * Send status message (for /status command)
     */
    async sendStatusMessage(aiStatus, prediction) {
        if (!this.isEnabled) return;
        
        const activeText = aiStatus.isActive ? '🟢 ACTIVE' : '⚪ WAITING';
        const accuracyText = aiStatus.accuracy ? `${aiStatus.accuracy.toFixed(1)}%` : 'N/A';
        
        let message = `
🤖 <b>AI SYSTEM STATUS</b>
━━━━━━━━━━━━━━━━━━━━━

📊 <b>Overall Stats:</b>
• Total Predictions: ${aiStatus.totalPredictions || 0}
• Correct: ${aiStatus.correctPredictions || 0}
• Accuracy: ${accuracyText}

🎯 <b>Current State:</b>
• Mode: ${activeText}
• Current Prediction: ${aiStatus.currentPrediction || 'None'}
• Consecutive Wrong: ${aiStatus.consecutiveWrongCount || 0}

📐 <b>Last 30 Frequencies:</b>
• LOW: ${aiStatus.currentFrequencies?.LOW || 0}
• MEDIUM: ${aiStatus.currentFrequencies?.MEDIUM || 0}
• HIGH: ${aiStatus.currentFrequencies?.HIGH || 0}
        `.trim();
        
        if (aiStatus.waitingReason) {
            message += `\n\n⚠️ <b>WAITING Reason:</b> ${aiStatus.waitingReason}`;
        }
        
        await this.sendMessage(message);
        console.log('📱 Telegram: Status message sent');
    }
    
    /**
     * Send stats message (for /stats command)
     */
    async sendStatsMessage(stats, last30Results) {
        if (!this.isEnabled) return;
        
        const message = `
📊 <b>LAST 30 RESULTS STATISTICS</b>
━━━━━━━━━━━━━━━━━━━━━

🔴 <b>LOW</b> (3-9)     → ${stats.LOW.percentage}% (${stats.LOW.count}/30) ${stats.LOW.trend.emoji} ${stats.LOW.trend.text}
🟡 <b>MEDIUM</b> (10-11) → ${stats.MEDIUM.percentage}% (${stats.MEDIUM.count}/30) ${stats.MEDIUM.trend.emoji} ${stats.MEDIUM.trend.text}
🟢 <b>HIGH</b> (12-18)   → ${stats.HIGH.percentage}% (${stats.HIGH.count}/30) ${stats.HIGH.trend.emoji} ${stats.HIGH.trend.text}

━━━━━━━━━━━━━━━━━━━━━
📐 <b>Median Calculation:</b>
${stats.LOW.count} → ${stats.MEDIUM.count} → ${stats.HIGH.count}
Median: <b>${[stats.LOW.count, stats.MEDIUM.count, stats.HIGH.count].sort((a,b)=>a-b)[1]}</b>
        `.trim();
        
        await this.sendMessage(message);
        console.log('📱 Telegram: Stats message sent');
    }
    
    /**
     * Send history message (for /history command)
     */
    async sendHistoryMessage(predictions) {
        if (!this.isEnabled) return;
        
        if (!predictions || predictions.length === 0) {
            await this.sendMessage('📜 No prediction history yet. Waiting for first prediction...');
            return;
        }
        
        const last10 = predictions.slice(0, 10);
        let historyText = '';
        
        for (const p of last10) {
            const icon = p.isCorrect === true ? '✅' : (p.isCorrect === false ? '❌' : '⏳');
            const date = new Date(p.timestamp).toLocaleString();
            historyText += `\n${icon} ${p.predictedGroup} → ${p.actualGroup || '?'} (${date.slice(0, 16)})`;
        }
        
        const message = `
📜 <b>LAST 10 PREDICTIONS</b>
━━━━━━━━━━━━━━━━━━━━━
${historyText}

━━━━━━━━━━━━━━━━━━━━━
📊 Overall Accuracy: ${this.getOverallAccuracy(predictions)}%
        `.trim();
        
        await this.sendMessage(message);
        console.log('📱 Telegram: History message sent');
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
     * Start polling for user commands - FIXED VERSION
     */
    async startPolling() {
        if (!this.isEnabled) {
            console.log('⚠️ Telegram bot not enabled, skipping polling');
            return;
        }
        
        console.log('🔄 Setting up Telegram bot polling...');
        
        // First, delete webhook with proper error handling
        const webhookDeleted = await this.deleteWebhook();
        
        if (!webhookDeleted) {
            console.log('⚠️ Could not delete webhook, but continuing with polling...');
        }
        
        // Wait a moment for webhook deletion to take effect
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test bot connection
        try {
            const testUrl = `https://api.telegram.org/bot${this.botToken}/getMe`;
            const response = await axios.get(testUrl, { timeout: 10000 });
            if (response.data && response.data.ok) {
                console.log(`✅ Bot connected: @${response.data.result.username}`);
            } else {
                console.log('⚠️ Bot connection test failed');
            }
        } catch (error) {
            console.error('❌ Bot connection test failed:', error.message);
            console.log('⚠️ Please check your TELEGRAM_BOT_TOKEN');
        }
        
        // Setup commands after connection
        await this.setupBotCommands();
        
        // Start polling with longer interval (5 seconds instead of 2)
        this.pollingInterval = setInterval(async () => {
            await this.pollUpdates();
        }, 5000);
        
        console.log('✅ Telegram bot polling started (interval: 5s)');
    }
    
    /**
     * Poll for updates from Telegram - FIXED VERSION
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
                
                if (updates && updates.length > 0) {
                    console.log(`📨 Received ${updates.length} update(s)`);
                }
                
                for (const update of updates) {
                    if (update.update_id > this.lastUpdateId) {
                        this.lastUpdateId = update.update_id;
                    }
                    
                    if (update.message && update.message.text) {
                        const chatId = update.message.chat.id;
                        const text = update.message.text.trim();
                        const command = text.toLowerCase();
                        
                        // Respond to any chat that sends a command (more flexible)
                        console.log(`📱 Command from chat ${chatId}: ${command}`);
                        
                        await this.handleCommand(command, chatId);
                    }
                }
            }
        } catch (error) {
            // 409 is not an error we should log - it's just "conflict" from rapid polling
            // Only log actual connection errors
            if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                console.log('⚠️ Telegram polling timeout, continuing...');
            } else if (error.response?.status === 409) {
                // 409 is normal, just continue
                // console.log('⏳ (Polling in progress)');
            } else if (error.response?.status === 404) {
                console.error('❌ Bot token invalid or bot not found');
                this.isEnabled = false;
                this.stopPolling();
            } else {
                // Only log other errors occasionally to avoid spam
                if (Math.random() < 0.1) {
                    console.error('Error polling Telegram updates:', error.message);
                }
            }
        }
    }
    
    /**
     * Handle user commands
     */
    async handleCommand(command, chatId) {
        console.log(`📱 Handling command: ${command}`);
        
        // Fetch current data from API
        const data = await this.fetchAPI('/api/all-data');
        
        if (!data) {
            await this.sendMessageToChat(chatId, '⚠️ Unable to fetch data from server. Please try again later.');
            return;
        }
        
        switch(command) {
            case '/start':
                await this.sendStartMessage(chatId, data);
                break;
            case '/predict':
                await this.sendPredictionFromAPI(chatId, data);
                break;
            case '/stats':
                await this.sendStatsFromAPI(chatId, data);
                break;
            case '/history':
                await this.sendHistoryFromAPI(chatId, data);
                break;
            case '/status':
                await this.sendStatusFromAPI(chatId, data);
                break;
            case '/reset':
                await this.handleReset(chatId);
                break;
            default:
                if (command.startsWith('/')) {
                    await this.sendMessageToChat(chatId, `❓ Unknown command: ${command}\n\n📱 Available commands: /start, /predict, /stats, /history, /status`);
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
            console.error(`API fetch error (${endpoint}):`, error.message);
            return null;
        }
    }
    
    /**
     * Send start message
     */
    async sendStartMessage(chatId, data) {
        const message = `
⚡ <b>Lightning Dice Predictor v13.1</b>
🤖 <b>Median-Based Statistical AI</b>
━━━━━━━━━━━━━━━━━━━━━

📊 <b>How it works:</b>
• Analyzes last 30 results
• Calculates frequency median
• Predicts median group when UNIQUE
• WAITING when duplicate or equal

━━━━━━━━━━━━━━━━━━━━━
📱 <b>Available Commands:</b>
/predict - Get current prediction
/stats - Show 30-result statistics
/history - Last 10 predictions
/status - AI system status
/reset - Reset AI (admin)
        `.trim();
        
        await this.sendMessageToChat(chatId, message);
    }
    
    /**
     * Send prediction from API
     */
    async sendPredictionFromAPI(chatId, data) {
        const prediction = data.currentPrediction;
        
        if (!prediction || prediction.status === 'WAITING' || prediction.waitingForData) {
            const waitingMessage = `
⏳ <b>WAITING MODE</b>

No unique median found yet.

${prediction?.message || 'Waiting for next result to create unique median condition.'}

📊 Use /stats to see current frequencies.
            `.trim();
            await this.sendMessageToChat(chatId, waitingMessage);
            return;
        }
        
        const stats = prediction.stats;
        const retryText = prediction.isRetry ? `\n🔄 RETRY #${prediction.retryCount + 1}` : '';
        
        const message = `
🎯 <b>CURRENT PREDICTION</b>${retryText}
━━━━━━━━━━━━━━━━━━━━━

📊 <b>Last 30 Results:</b>
🔴 LOW: ${stats.LOW.percentage}% (${stats.LOW.count}/30) ${stats.LOW.trend.emoji}
🟡 MEDIUM: ${stats.MEDIUM.percentage}% (${stats.MEDIUM.count}/30) ${stats.MEDIUM.trend.emoji}
🟢 HIGH: ${stats.HIGH.percentage}% (${stats.HIGH.count}/30) ${stats.HIGH.trend.emoji}

━━━━━━━━━━━━━━━━━━━━━
🎯 <b>PREDICTION: ${prediction.predictedGroup}</b>
💪 Confidence: ${prediction.confidence}%

${prediction.message}
        `.trim();
        
        await this.sendMessageToChat(chatId, message);
    }
    
    /**
     * Send stats from API
     */
    async sendStatsFromAPI(chatId, data) {
        const prediction = data.currentPrediction;
        
        if (!prediction || !prediction.stats) {
            await this.sendMessageToChat(chatId, '⚠️ Unable to fetch statistics. Please try again.');
            return;
        }
        
        const stats = prediction.stats;
        
        const message = `
📊 <b>LAST 30 RESULTS STATISTICS</b>
━━━━━━━━━━━━━━━━━━━━━

🔴 <b>LOW</b> (3-9)     → ${stats.LOW.percentage}% (${stats.LOW.count}/30) ${stats.LOW.trend.emoji} ${stats.LOW.trend.text}
🟡 <b>MEDIUM</b> (10-11) → ${stats.MEDIUM.percentage}% (${stats.MEDIUM.count}/30) ${stats.MEDIUM.trend.emoji} ${stats.MEDIUM.trend.text}
🟢 <b>HIGH</b> (12-18)   → ${stats.HIGH.percentage}% (${stats.HIGH.count}/30) ${stats.HIGH.trend.emoji} ${stats.HIGH.trend.text}

━━━━━━━━━━━━━━━━━━━━━
📐 <b>Raw Frequencies:</b>
<code>${stats.LOW.count} → ${stats.MEDIUM.count} → ${stats.HIGH.count}</code>

Median: <b>${[stats.LOW.count, stats.MEDIUM.count, stats.HIGH.count].sort((a,b)=>a-b)[1]}</b>
        `.trim();
        
        await this.sendMessageToChat(chatId, message);
    }
    
    /**
     * Send history from API
     */
    async sendHistoryFromAPI(chatId, data) {
        const predictions = data.predictions || [];
        
        if (predictions.length === 0) {
            await this.sendMessageToChat(chatId, '📜 No prediction history yet. Waiting for data...');
            return;
        }
        
        const last10 = predictions.slice(0, 10);
        let historyText = '';
        
        for (const p of last10) {
            const icon = p.isCorrect === true ? '✅' : (p.isCorrect === false ? '❌' : '⏳');
            const time = p.time || (p.timestamp ? new Date(p.timestamp).toLocaleTimeString() : '--');
            historyText += `\n${icon} ${p.predictedGroup} → ${p.actualGroup || '?'} (${time})`;
        }
        
        const correct = predictions.filter(p => p.isCorrect === true).length;
        const total = predictions.filter(p => p.isCorrect !== null).length;
        const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : 0;
        
        const message = `
📜 <b>LAST 10 PREDICTIONS</b>
━━━━━━━━━━━━━━━━━━━━━
${historyText}

━━━━━━━━━━━━━━━━━━━━━
📊 Overall Accuracy: ${accuracy}% (${correct}/${total})
        `.trim();
        
        await this.sendMessageToChat(chatId, message);
    }
    
    /**
     * Send status from API
     */
    async sendStatusFromAPI(chatId, data) {
        const aiStats = data.aiStats || {};
        const prediction = data.currentPrediction;
        
        const accuracy = aiStats.accuracy || 0;
        const totalPredictions = aiStats.total_predictions || 0;
        const correctPredictions = aiStats.correct_predictions || 0;
        
        const isActive = prediction && prediction.status !== 'WAITING' && !prediction.waitingForData;
        
        const message = `
🤖 <b>AI SYSTEM STATUS</b>
━━━━━━━━━━━━━━━━━━━━━

📊 <b>Overall Stats:</b>
• Total Predictions: ${totalPredictions}
• Correct: ${correctPredictions}
• Accuracy: ${typeof accuracy === 'number' ? accuracy.toFixed(1) : '0'}%

🎯 <b>Current State:</b>
• Mode: ${isActive ? '🟢 PREDICTION ACTIVE' : '⚪ WAITING MODE'}
• Current Prediction: ${prediction?.predictedGroup || 'None'}
• Retry Count: ${prediction?.retryCount || 0}

📐 <b>Algorithm:</b>
Median-Based Statistical AI (v13.1)
Analyzes last 30 results → predicts median group when unique
        `.trim();
        
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
                await this.sendMessageToChat(chatId, '🔄 AI has been reset to WAITING mode.');
            } else {
                await this.sendMessageToChat(chatId, '⚠️ Failed to reset AI. Please try again.');
            }
        } catch (error) {
            console.error('Reset error:', error.message);
            await this.sendMessageToChat(chatId, '⚠️ Error resetting AI. Server may be unavailable.');
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
