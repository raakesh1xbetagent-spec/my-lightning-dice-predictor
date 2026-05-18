// ============================================================
// server.js (v14.0 - TRIPLE PREDICTOR AI) - FIXED VERSION
// Features: 
// - 10-result analysis with THREE predictors (MEDIAN, HIGH-VOL, LOW-VOL)
// - Shared WAITING on duplicate medians
// - Shared retry system for all predictors
// - Database stores all three predictions separately
// - Telegram: Full notification system for all states
// ============================================================

// Fix memory leak warnings
require('events').EventEmitter.defaultMaxListeners = 20;
process.setMaxListeners(20);

// Load environment variables for Telegram
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const WebSocket = require('ws');
const fs = require('fs');

// ============ AI IMPORT ============
const { MedianBasedAI } = require('./new-ai-logic');

// ============ TELEGRAM BOT IMPORT ============
const TelegramBot = require('./telegram-bot');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ GLOBALS ============
let serverAI = null;
let telegramBot = null;

// ============ TELEGRAM NOTIFICATION HELPER ============
async function sendTelegramPrediction(prediction) {
    if (telegramBot && telegramBot.isEnabled) {
        try {
            if (typeof telegramBot.sendPredictionNotification === 'function') {
                await telegramBot.sendPredictionNotification(prediction);
            } else if (typeof telegramBot.sendTriplePredictionNotification === 'function') {
                const frequencies = prediction?.stats;
                await telegramBot.sendTriplePredictionNotification(prediction, {
                    LOW: frequencies?.LOW?.count || 0,
                    MEDIUM: frequencies?.MEDIUM?.count || 0,
                    HIGH: frequencies?.HIGH?.count || 0
                });
            }
        } catch (err) {
            console.log('⚠️ Telegram prediction send error:', err.message);
        }
    }
}

async function sendTelegramWaiting(waitingData) {
    if (telegramBot && telegramBot.isEnabled) {
        try {
            if (typeof telegramBot.sendWaitingNotification === 'function') {
                await telegramBot.sendWaitingNotification(waitingData);
            } else if (typeof telegramBot.sendTripleWaitingNotification === 'function') {
                const frequencies = waitingData?.stats;
                await telegramBot.sendTripleWaitingNotification(waitingData, {
                    LOW: frequencies?.LOW?.count || 0,
                    MEDIUM: frequencies?.MEDIUM?.count || 0,
                    HIGH: frequencies?.HIGH?.count || 0
                });
            }
        } catch (err) {
            console.log('⚠️ Telegram waiting send error:', err.message);
        }
    }
}

async function sendTelegramCorrect(predictedGroups, actualGroup, retryCount) {
    if (telegramBot && telegramBot.isEnabled) {
        try {
            if (typeof telegramBot.sendTripleCorrectNotification === 'function') {
                await telegramBot.sendTripleCorrectNotification(predictedGroups, actualGroup, retryCount);
            }
        } catch (err) {
            console.log('⚠️ Telegram correct send error:', err.message);
        }
    }
}

async function sendTelegramWrong(predictedGroups, actualGroup, retryCount) {
    if (telegramBot && telegramBot.isEnabled) {
        try {
            if (typeof telegramBot.sendTripleWrongNotification === 'function') {
                await telegramBot.sendTripleWrongNotification(predictedGroups, actualGroup, retryCount);
            }
        } catch (err) {
            console.log('⚠️ Telegram wrong send error:', err.message);
        }
    }
}

// Ensure database directory exists
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('📁 Created data directory:', dbDir);
}

// Database setup
const dbPath = path.join(dbDir, 'lightning_dice.db');
console.log('📂 Database path:', dbPath);
const db = new sqlite3.Database(dbPath);

// Create tables (UPDATED for v14.0 - Triple Predictor)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        total INTEGER,
        group_name TEXT,
        multiplier INTEGER,
        dice_values TEXT,
        timestamp DATETIME,
        winners INTEGER,
        payout INTEGER
    )`);
    
    // Updated predictions table for triple predictors
    db.run(`CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        result_id TEXT UNIQUE,
        pattern_3step TEXT,
        protection_type TEXT,
        predicted_group TEXT,
        prediction_timestamp DATETIME,
        actual_group TEXT,
        actual_timestamp DATETIME,
        is_correct INTEGER DEFAULT -1,
        is_retry INTEGER DEFAULT 0,
        retry_number INTEGER DEFAULT 0,
        median_value INTEGER,
        frequencies TEXT,
        confidence INTEGER,
        waiting_reason TEXT,
        -- New columns for triple predictors
        predicted_high_vol TEXT,
        predicted_low_vol TEXT,
        confidence_high_vol INTEGER,
        confidence_low_vol INTEGER,
        is_high_vol_correct INTEGER DEFAULT -1,
        is_low_vol_correct INTEGER DEFAULT -1
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS ai_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_predictions INTEGER DEFAULT 0,
        correct_predictions INTEGER DEFAULT 0,
        accuracy REAL DEFAULT 0,
        last_updated DATETIME
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS ai_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_data TEXT,
        updated_at DATETIME
    )`);
    
    // Add new columns if not exists (for backward compatibility)
    db.run(`ALTER TABLE predictions ADD COLUMN median_value INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    db.run(`ALTER TABLE predictions ADD COLUMN frequencies TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    db.run(`ALTER TABLE predictions ADD COLUMN confidence INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    db.run(`ALTER TABLE predictions ADD COLUMN waiting_reason TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    // Triple predictor columns
    db.run(`ALTER TABLE predictions ADD COLUMN predicted_high_vol TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    db.run(`ALTER TABLE predictions ADD COLUMN predicted_low_vol TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    db.run(`ALTER TABLE predictions ADD COLUMN confidence_high_vol INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    db.run(`ALTER TABLE predictions ADD COLUMN confidence_low_vol INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    db.run(`ALTER TABLE predictions ADD COLUMN is_high_vol_correct INTEGER DEFAULT -1`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    db.run(`ALTER TABLE predictions ADD COLUMN is_low_vol_correct INTEGER DEFAULT -1`, (err) => {
        if (err && !err.message.includes('duplicate column')) {}
    });
    
    console.log('✅ Database tables created/verified (v14.0 Triple Predictor AI ready)');
});

// ============ AI MODEL INITIALIZATION ============
async function initNewAI() {
    console.log('🤖 Initializing Triple Predictor Statistical AI (v14.0)...');
    serverAI = new MedianBasedAI();
    
    try {
        // Load AI state
        const savedState = await new Promise((resolve) => {
            db.get(`SELECT state_data FROM ai_state WHERE id = 1`, (err, row) => {
                if (err || !row) {
                    resolve(null);
                } else {
                    try {
                        resolve(JSON.parse(row.state_data));
                    } catch (e) {
                        resolve(null);
                    }
                }
            });
        });
        
        if (savedState) {
            serverAI.loadState(savedState);
            console.log(`📀 Loaded AI state from database`);
        }
    } catch (err) {
        console.log('No existing AI state found, starting fresh');
    }
    
    console.log(`✅ AI ready - Triple Predictor Statistical AI v${serverAI.version}`);
    console.log(`📊 Core Logic:`);
    console.log(`   - Analyzes last 10 results`);
    console.log(`   - THREE PREDICTORS:`);
    console.log(`     1. MEDIAN: Unique median prediction`);
    console.log(`     2. HIGH-VOLUME: Most frequent group`);
    console.log(`     3. LOW-VOLUME: Least frequent group`);
    console.log(`   - WAITING on duplicate median (affects ALL three)`);
    console.log(`   - Shared retry system for all predictors`);
}

// Initialize Telegram Bot
function initTelegramBot() {
    const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${PORT}`;
    telegramBot = new TelegramBot(apiBaseUrl);
    
    if (telegramBot.isEnabled) {
        telegramBot.startPolling();
        console.log('🤖 Telegram Bot started - listening for commands');
        console.log('   Commands: /predict, /stats, /history, /status, /reset');
    } else {
        console.log('⚠️ Telegram Bot not configured - set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
    }
}

// Save AI state to database periodically
async function saveAIState() {
    if (!serverAI) return;
    
    try {
        const state = serverAI.exportState();
        db.run(`INSERT OR REPLACE INTO ai_state (id, state_data, updated_at) VALUES (1, ?, ?)`,
            [JSON.stringify(state), new Date().toISOString()],
            (err) => {
                if (err) console.error('Error saving AI state:', err);
                else console.log('💾 AI state saved to database');
            }
        );
    } catch (err) {
        console.error('Error exporting AI state:', err);
    }
}

setInterval(saveAIState, 5 * 60 * 1000);

// ============ CORS & MIDDLEWARE ============
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));

// ============ WEB SOCKET SERVER ============
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n⚡ Lightning Dice Predictor v14.0 - Triple Predictor AI`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`🚀 Server running on port ${PORT}\n`);
    initNewAI();
    initTelegramBot();
    setTimeout(checkDatabaseOnStartup, 2000);
});

const wss = new WebSocket.Server({ server });

const clients = new Set();

wss.on('connection', (ws) => {
    ws.setMaxListeners(20);
    
    ws.once('error', (error) => {
        console.error('WebSocket error:', error);
    });
    
    clients.add(ws);
    console.log(`🔌 Client connected. Total clients: ${clients.size}`);
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log(`🔌 Client disconnected. Total clients: ${clients.size}`);
    });
});

function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ============ DATA RETRIEVAL HELPER FUNCTIONS ============

function getResultsData(limit = 100) {
    return new Promise((resolve) => {
        db.all(`SELECT id, total, group_name as groupName, multiplier, dice_values as diceValues, timestamp 
                FROM results ORDER BY timestamp DESC LIMIT ?`, [limit], (err, rows) => {
            if (err) {
                console.error('Error in getResultsData:', err);
                resolve([]);
            } else {
                const formatted = (rows || []).map(row => ({
                    id: row.id,
                    total: row.total,
                    group: row.groupName,
                    multiplier: row.multiplier,
                    diceValues: row.diceValues,
                    timestamp: row.timestamp
                }));
                formatted.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                console.log(`✅ getResultsData returning ${formatted.length} results`);
                resolve(formatted);
            }
        });
    });
}

function getLast10Results() {
    return new Promise((resolve) => {
        db.all(`SELECT total, group_name, timestamp 
                FROM results ORDER BY timestamp DESC LIMIT 10`, (err, rows) => {
            if (err) {
                console.error('Error in getLast10Results:', err);
                resolve([]);
            } else {
                const formatted = (rows || []).map(row => ({
                    total: row.total,
                    group: row.group_name,
                    timestamp: row.timestamp
                }));
                // Return in chronological order (oldest first for AI)
                const chronological = formatted.reverse();
                console.log(`📊 getLast10Results returning ${chronological.length} results`);
                resolve(chronological);
            }
        });
    });
}

function getPredictionsData(limit = 500) {
    return new Promise((resolve) => {
        db.all(`SELECT p.*, r.total, r.dice_values, r.timestamp as result_time
                FROM predictions p
                LEFT JOIN results r ON p.result_id = r.id
                WHERE p.predicted_group IS NOT NULL 
                  AND p.predicted_group != 'WAITING'
                ORDER BY p.prediction_timestamp DESC LIMIT ?`, [limit], (err, rows) => {
            if (err) {
                console.error('Error in getPredictionsData:', err);
                resolve([]);
            } else {
                const transformed = (rows || []).map(p => ({
                    id: p.result_id,
                    time: p.prediction_timestamp ? new Date(p.prediction_timestamp).toLocaleTimeString() : '--',
                    dice: p.dice_values || '--',
                    total: p.total || '--',
                    actualGroup: p.actual_group || null,
                    predictedGroup: p.predicted_group || '--',
                    predictedHighVol: p.predicted_high_vol || null,
                    predictedLowVol: p.predicted_low_vol || null,
                    isCorrect: p.is_correct === 1,
                    isHighVolCorrect: p.is_high_vol_correct === 1,
                    isLowVolCorrect: p.is_low_vol_correct === 1,
                    isRetry: p.is_retry === 1,
                    retryNumber: p.retry_number || 0,
                    medianValue: p.median_value,
                    confidence: p.confidence,
                    confidenceHighVol: p.confidence_high_vol,
                    confidenceLowVol: p.confidence_low_vol,
                    timestamp: new Date(p.prediction_timestamp),
                    isPending: p.actual_group === null
                }));
                console.log(`✅ getPredictionsData returning ${transformed.length} valid predictions`);
                resolve(transformed);
            }
        });
    });
}

function getStatsData() {
    return new Promise((resolve) => {
        db.get(`SELECT 
                    COUNT(*) as totalRounds,
                    COALESCE(AVG(total), 0) as avgResult,
                    (SELECT group_name FROM results GROUP BY group_name ORDER BY COUNT(*) DESC LIMIT 1) as mostActiveGroup
                FROM results`, (err, stats) => {
            if (err) {
                console.error('Error in getStatsData:', err);
                resolve({ totalRounds: 0, avgResult: 0, mostActiveGroup: 'LOW', lightningBoost: 0 });
            } else {
                db.get(`SELECT COUNT(*) as lightningCount FROM results WHERE multiplier > 10`, (err, lightning) => {
                    db.get(`SELECT COUNT(*) as total FROM results`, (err, total) => {
                        const lightningPercent = total && total.total > 0 ? (lightning?.lightningCount || 0) / total.total * 100 : 0;
                        resolve({
                            totalRounds: stats?.totalRounds || 0,
                            avgResult: stats?.avgResult ? stats.avgResult.toFixed(2) : 0,
                            mostActiveGroup: stats?.mostActiveGroup || 'LOW',
                            lightningBoost: Math.round(lightningPercent)
                        });
                    });
                });
            }
        });
    });
}

function getAIStatsData() {
    return new Promise((resolve) => {
        db.get(`SELECT total_predictions, correct_predictions, accuracy FROM ai_stats ORDER BY id DESC LIMIT 1`, (err, row) => {
            if (err) {
                console.error('Error in getAIStatsData:', err);
                resolve({ totalPredictions: 0, accuracy: 0 });
            } else {
                resolve(row || { totalPredictions: 0, accuracy: 0 });
            }
        });
    });
}

async function getCurrentPredictionData() {
    const last10Results = await getLast10Results();
    
    if (!last10Results || last10Results.length < 10) {
        console.log(`⚠️ Not enough history for prediction (need 10 results, have ${last10Results?.length || 0})`);
        return {
            status: "WAITING",
            waitingReason: "INSUFFICIENT_DATA",
            predictedGroup: null,
            confidence: 0,
            waitingForData: true,
            message: `Waiting for 10 results. Currently have ${last10Results?.length || 0}/10`,
            stats: {
                LOW: { count: 0, percentage: 0, trend: { emoji: '⚖️', text: 'Waiting' } },
                MEDIUM: { count: 0, percentage: 0, trend: { emoji: '⚖️', text: 'Waiting' } },
                HIGH: { count: 0, percentage: 0, trend: { emoji: '⚖️', text: 'Waiting' } }
            }
        };
    }
    
    console.log(`🔮 Analyzing last 10 results for triple prediction...`);
    
    if (serverAI) {
        const prediction = serverAI.predict(last10Results);
        return prediction;
    }
    
    // Fallback
    return {
        status: "ERROR",
        predictedGroup: null,
        confidence: 0,
        waitingForData: true,
        message: "AI not initialized"
    };
}

async function savePredictionOnly(resultId, last10Results) {
    if (!last10Results || last10Results.length < 10) {
        console.log(`⚠️ Cannot save prediction for ${resultId}: need 10 results, have ${last10Results?.length || 0}`);
        return null;
    }
    
    console.log(`🔮 Generating triple prediction for ${resultId}...`);
    
    const prediction = await getCurrentPredictionData();
    
    // Don't save if no valid prediction (WAITING mode)
    if (prediction.status === "WAITING" || !prediction.median || !prediction.median.predictedGroup) {
        console.log(`⚠️ NOT saving prediction for ${resultId} - AI is in WAITING mode`);
        
        // Still save waiting state for tracking
        const existing = await new Promise((resolve) => {
            db.get(`SELECT id FROM predictions WHERE result_id = ?`, [resultId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!existing) {
            db.run(`INSERT INTO predictions (
                    result_id, protection_type, predicted_group, prediction_timestamp, 
                    is_correct, waiting_reason
                ) VALUES (?, ?, ?, ?, -1, ?)`,
                [resultId, 'TRIPLE_AI', 'WAITING', new Date().toISOString(), prediction.waitingReason || 'UNKNOWN']);
        }
        return null;
    }
    
    console.log(`\n📝 SAVING TRIPLE PREDICTION for ${resultId}:`);
    console.log(`   MEDIAN: ${prediction.median.predictedGroup} (${prediction.median.confidence}%)`);
    console.log(`   HIGH-VOLUME: ${prediction.highVolume.predictedGroup} (${prediction.highVolume.confidence}%)`);
    console.log(`   LOW-VOLUME: ${prediction.lowVolume.predictedGroup} (${prediction.lowVolume.confidence}%)`);
    console.log(`   Shared Retry Count: ${prediction.retryCount || 0}`);
    
    const frequencies = prediction.frequencies;
    const frequenciesJson = JSON.stringify(frequencies);
    
    const existing = await new Promise((resolve) => {
        db.get(`SELECT id FROM predictions WHERE result_id = ?`, [resultId], (err, row) => {
            resolve(row);
        });
    });
    
    const isRetry = prediction.isRetry ? 1 : 0;
    const retryNumber = prediction.retryCount || 0;
    
    const medianGroup = prediction.median.predictedGroup;
    const medianConfidence = prediction.median.confidence;
    const highVolGroup = prediction.highVolume.predictedGroup;
    const highVolConfidence = prediction.highVolume.confidence;
    const lowVolGroup = prediction.lowVolume.predictedGroup;
    const lowVolConfidence = prediction.lowVolume.confidence;
    
    if (existing) {
        return new Promise((resolve) => {
            db.run(`UPDATE predictions SET 
                    protection_type = ?,
                    predicted_group = ?,
                    predicted_high_vol = ?,
                    predicted_low_vol = ?,
                    prediction_timestamp = ?,
                    is_retry = ?,
                    retry_number = ?,
                    median_value = ?,
                    frequencies = ?,
                    confidence = ?,
                    confidence_high_vol = ?,
                    confidence_low_vol = ?,
                    waiting_reason = NULL
                    WHERE result_id = ?`,
                ['TRIPLE_AI', medianGroup, highVolGroup, lowVolGroup, new Date().toISOString(), 
                 isRetry, retryNumber, prediction.medianValue, frequenciesJson, 
                 medianConfidence, highVolConfidence, lowVolConfidence, resultId],
                (err) => {
                    if (err) {
                        console.error('Error updating prediction:', err);
                        resolve(null);
                    } else {
                        console.log(`✅ Triple Prediction UPDATED for ${resultId}`);
                        resolve(prediction);
                    }
                }
            );
        });
    } else {
        return new Promise((resolve) => {
            db.run(`INSERT INTO predictions (
                    result_id, protection_type, predicted_group, predicted_high_vol, predicted_low_vol,
                    prediction_timestamp, is_correct, is_retry, retry_number, 
                    median_value, frequencies, confidence, confidence_high_vol, confidence_low_vol
                ) VALUES (?, ?, ?, ?, ?, ?, -1, ?, ?, ?, ?, ?, ?, ?)`,
                [resultId, 'TRIPLE_AI', medianGroup, highVolGroup, lowVolGroup, new Date().toISOString(),
                 isRetry, retryNumber, prediction.medianValue, frequenciesJson, 
                 medianConfidence, highVolConfidence, lowVolConfidence],
                (err) => {
                    if (err) {
                        console.error('Error saving prediction:', err);
                        resolve(null);
                    } else {
                        console.log(`✅ Triple Prediction INSERTED for ${resultId}`);
                        resolve(prediction);
                    }
                }
            );
        });
    }
}

// ============================================================
// FIXED updatePredictionWithResult - Enhanced version
// ============================================================
async function updatePredictionWithResult(resultId, actualGroup) {
    console.log(`\n📊 UPDATING TRIPLE PREDICTION with result for ${resultId}:`);
    console.log(`   ACTUAL RESULT: ${actualGroup}`);
    
    const prediction = await new Promise((resolve) => {
        db.get(`SELECT predicted_group, predicted_high_vol, predicted_low_vol, is_retry, retry_number, confidence 
                FROM predictions WHERE result_id = ?`, [resultId], (err, row) => {
            if (err) {
                console.error('Error fetching prediction:', err);
                resolve(null);
            } else {
                resolve(row);
            }
        });
    });
    
    if (!prediction) {
        console.log(`⚠️ No prediction found for ${resultId}, cannot update`);
        return null;
    }
    
    if (prediction.predicted_group === 'WAITING') {
        console.log(`⚠️ Prediction was WAITING mode, skipping result update`);
        return null;
    }
    
    const isMedianCorrect = (prediction.predicted_group === actualGroup) ? 1 : 0;
    const isHighVolCorrect = (prediction.predicted_high_vol === actualGroup) ? 1 : 0;
    const isLowVolCorrect = (prediction.predicted_low_vol === actualGroup) ? 1 : 0;
    const retryCount = prediction.retry_number || 0;
    
    console.log(`   RESULTS:`);
    console.log(`   MEDIAN: ${prediction.predicted_group} → ${isMedianCorrect ? '✓ CORRECT' : '✗ WRONG'}`);
    console.log(`   HIGH-VOL: ${prediction.predicted_high_vol} → ${isHighVolCorrect ? '✓ CORRECT' : '✗ WRONG'}`);
    console.log(`   LOW-VOL: ${prediction.predicted_low_vol} → ${isLowVolCorrect ? '✓ CORRECT' : '✗ WRONG'}`);
    
    const last10Results = await getLast10Results();
    
    // Send Telegram notifications
    const predictedGroups = {
        median: prediction.predicted_group,
        highVolume: prediction.predicted_high_vol,
        lowVolume: prediction.predicted_low_vol
    };
    
    if (isMedianCorrect === 1) {
        await sendTelegramCorrect(predictedGroups, actualGroup, retryCount);
    } else {
        await sendTelegramWrong(predictedGroups, actualGroup, retryCount + 1);
    }
    
    // Update AI state
    if (serverAI && last10Results.length >= 10) {
        serverAI.updateWithResult(actualGroup, last10Results);
        console.log(`   Shared AI Accuracy updated: ${serverAI.getAccuracy().toFixed(1)}%`);
        console.log(`   Shared Wrong Count: ${serverAI.consecutiveWrongCount}`);
    }
    
    // UPDATE DATABASE
    return new Promise((resolve) => {
        db.run(`UPDATE predictions SET
                actual_group = ?,
                actual_timestamp = ?,
                is_correct = ?,
                is_high_vol_correct = ?,
                is_low_vol_correct = ?
                WHERE result_id = ?`,
            [actualGroup, new Date().toISOString(), isMedianCorrect, isHighVolCorrect, isLowVolCorrect, resultId],
            function(err) {
                if (err) {
                    console.error(`❌ SQL UPDATE ERROR for ${resultId}:`, err.message);
                    resolve({ success: false, error: err.message });
                } else {
                    console.log(`✅ SQL UPDATE SUCCESS for ${resultId}: ${this.changes} row(s) affected`);
                    if (this.changes === 0) {
                        console.log(`⚠️ WARNING: No rows were updated! result_id ${resultId} may not exist.`);
                    } else {
                        console.log(`✅ Triple Prediction UPDATED with result for ${resultId}`);
                    }
                    updateAIStatsTable(isMedianCorrect === 1);
                    resolve({ success: true, changes: this.changes, 
                             isMedianCorrect, isHighVolCorrect, isLowVolCorrect });
                }
            }
        );
    });
}

async function updateAIStatsTable(correct) {
    return new Promise((resolve) => {
        db.get(`SELECT total_predictions, correct_predictions FROM ai_stats ORDER BY id DESC LIMIT 1`, (err, stat) => {
            const total = (stat ? stat.total_predictions : 0) + 1;
            const correctTotal = (stat ? stat.correct_predictions : 0) + (correct ? 1 : 0);
            const accuracy = (correctTotal / total) * 100;
            
            db.run(`INSERT INTO ai_stats (total_predictions, correct_predictions, accuracy, last_updated)
                    VALUES (?, ?, ?, ?)`,
                [total, correctTotal, accuracy, new Date().toISOString()],
                () => resolve()
            );
        });
    });
}

// ============================================================
// broadcastFullDataOnNewResult - always fetch fresh predictions
// ============================================================
async function broadcastFullDataOnNewResult(gameResult, predictionData) {
    console.log(`📡 Preparing broadcast for ${clients.size} clients...`);
    
    // Always fetch fresh predictions after update
    const freshPredictions = await getPredictionsData(500);
    
    const [results, stats, aiStats] = await Promise.all([
        getResultsData(100),
        getStatsData(),
        getAIStatsData()
    ]);
    
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const last10Results = await getLast10Results();
    const last10Groups = last10Results.map(r => r.group);
    
    const message = JSON.stringify({
        type: 'new_result',
        result: {
            id: gameResult.id,
            total: gameResult.total,
            group: gameResult.group_name,
            multiplier: gameResult.multiplier,
            diceValues: gameResult.dice_values,
            timestamp: gameResult.timestamp
        },
        prediction: predictionData,
        history: freshPredictions,
        stats: stats,
        aiStats: aiStats,
        allResults: results,
        last10Groups: last10Groups
    });
    
    let sentCount = 0;
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            sentCount++;
        }
    });
    console.log(`✅ Broadcast sent to ${sentCount} clients`);
}

let lastGameId = null;
let isCollecting = false;
let pendingPredictions = new Set();

function getGroup(number) {
    if (number >= 3 && number <= 9) return 'LOW';
    if (number >= 10 && number <= 11) return 'MEDIUM';
    if (number >= 12 && number <= 18) return 'HIGH';
    return 'UNKNOWN';
}

async function saveGameResult(game) {
    const total = game.result.total;
    const group = getGroup(total);
    const multipliers = game.result.luckyNumbersList || [];
    const multiplierItem = multipliers.find(m => m.outcome === `LightningDice_Total${total}`);
    const diceValues = game.result.value || '⚀ ⚀ ⚀';
    
    const result = {
        id: game.id,
        total: total,
        group_name: group,
        multiplier: multiplierItem ? multiplierItem.multiplier : 1,
        dice_values: diceValues,
        timestamp: new Date(game.settledAt).toISOString(),
        winners: game.totalWinners || 0,
        payout: game.totalAmount || 0
    };
    
    return new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO results (id, total, group_name, multiplier, dice_values, timestamp, winners, payout)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [result.id, result.total, result.group_name, result.multiplier, result.dice_values, result.timestamp, result.winners, result.payout],
            (err) => {
                if (err) {
                    console.error('Error saving result:', err);
                    reject(err);
                } else {
                    console.log(`💾 Result saved: ${result.id} -> ${result.group_name}`);
                    setTimeout(() => resolve(result), 100);
                }
            }
        );
    });
}

// ============================================================
// FIXED collectData() function - With proper timing and retry
// ============================================================
async function collectData() {
    if (isCollecting) return;
    isCollecting = true;
    
    try {
        const response = await axios.get('https://api-cs.casino.org/svc-evolution-game-events/api/lightningdice/latest', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            },
            timeout: 10000
        });
        
        if (response.data && response.data.data) {
            const game = response.data.data;
            const gameId = game.id;
            
            if (lastGameId !== gameId) {
                lastGameId = gameId;
                
                const exists = await new Promise((resolve) => {
                    db.get(`SELECT id FROM results WHERE id = ?`, [gameId], (err, row) => {
                        resolve(!!row);
                    });
                });
                
                if (!exists) {
                    console.log(`🆕 New game detected: ${gameId}`);
                    
                    const last10Results = await getLast10Results();
                    console.log(`📜 Last 10 results count: ${last10Results.length}`);
                    
                    let predictionData = null;
                    
                    // STEP 1: Save prediction FIRST (before result)
                    if (last10Results.length >= 10) {
                        pendingPredictions.add(gameId);
                        console.log(`🔮 Saving triple prediction FIRST for ${gameId}...`);
                        predictionData = await savePredictionOnly(gameId, last10Results);
                        
                        if (predictionData && predictionData.status === 'PREDICTION_READY') {
                            await sendTelegramPrediction(predictionData);
                        } else if (predictionData && predictionData.status === 'WAITING') {
                            await sendTelegramWaiting(predictionData);
                        }
                    } else {
                        console.log(`⚠️ Cannot save prediction: need 10+ history, have ${last10Results.length}`);
                    }
                    
                    // STEP 2: Save the actual result
                    const savedResult = await saveGameResult(game);
                    const totalResult = game.result.total;
                    const group = getGroup(totalResult);
                    console.log(`📊 Actual result: ${totalResult} → ${group}`);
                    
                    // STEP 3: Wait a moment for prediction to be fully saved
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // STEP 4: Update prediction with actual result
                    const predictionExists = await new Promise((resolve) => {
                        db.get(`SELECT id FROM predictions WHERE result_id = ?`, [gameId], (err, row) => {
                            resolve(!!row);
                        });
                    });
                    
                    if (predictionExists) {
                        console.log(`🔄 Updating prediction for ${gameId} with actual group: ${group}`);
                        const updateResult = await updatePredictionWithResult(gameId, group);
                        console.log(`📊 Update result:`, updateResult);
                    } else {
                        console.log(`⚠️ No prediction found for ${gameId} in DB, creating waiting record`);
                        // Insert a record that it was waiting
                        db.run(`INSERT OR REPLACE INTO predictions (result_id, protection_type, predicted_group, actual_group, actual_timestamp, is_correct)
                                VALUES (?, ?, ?, ?, ?, -1)`,
                            [gameId, 'WAITING_MODE', 'WAITING', group, new Date().toISOString()]);
                    }
                    
                    pendingPredictions.delete(gameId);
                    
                    // STEP 5: Get fresh current prediction and broadcast
                    const currentPrediction = await getCurrentPredictionData();
                    await broadcastFullDataOnNewResult(savedResult, currentPrediction);
                    
                    console.log(`✅ Complete triple flow done for game: ${gameId}`);
                }
            }
        }
    } catch (error) {
        console.error('❌ Data collection error:', error.message);
    }
    
    isCollecting = false;
}

async function checkDatabaseOnStartup() {
    console.log('\n🔍 STARTUP DATABASE CHECK:');
    const resultCount = await new Promise((resolve) => {
        db.get(`SELECT COUNT(*) as count FROM results`, (err, row) => {
            resolve(row ? row.count : 0);
        });
    });
    console.log(`   📊 Total results in database: ${resultCount}`);
    
    if (resultCount >= 10) {
        const last10Results = await getLast10Results();
        const freq = { LOW: 0, MEDIUM: 0, HIGH: 0 };
        for (const r of last10Results) {
            freq[r.group]++;
        }
        console.log(`   📊 Last 10 frequencies: LOW=${freq.LOW}, MEDIUM=${freq.MEDIUM}, HIGH=${freq.HIGH}`);
        
        const sorted = [freq.LOW, freq.MEDIUM, freq.HIGH].sort((a,b) => a-b);
        const median = sorted[1];
        console.log(`   📐 Median: ${median}`);
        
        let medianGroup = 'UNKNOWN';
        if (freq.LOW === median && freq.MEDIUM !== median && freq.HIGH !== median) medianGroup = 'LOW';
        else if (freq.MEDIUM === median && freq.LOW !== median && freq.HIGH !== median) medianGroup = 'MEDIUM';
        else if (freq.HIGH === median && freq.LOW !== median && freq.MEDIUM !== median) medianGroup = 'HIGH';
        else medianGroup = 'DUPLICATE/WAITING';
        
        let highVolGroup = 'UNKNOWN';
        let lowVolGroup = 'UNKNOWN';
        
        if (freq.LOW > freq.MEDIUM && freq.LOW > freq.HIGH) highVolGroup = 'LOW';
        else if (freq.MEDIUM > freq.LOW && freq.MEDIUM > freq.HIGH) highVolGroup = 'MEDIUM';
        else if (freq.HIGH > freq.LOW && freq.HIGH > freq.MEDIUM) highVolGroup = 'HIGH';
        else highVolGroup = 'TIE';
        
        if (freq.LOW < freq.MEDIUM && freq.LOW < freq.HIGH) lowVolGroup = 'LOW';
        else if (freq.MEDIUM < freq.LOW && freq.MEDIUM < freq.HIGH) lowVolGroup = 'MEDIUM';
        else if (freq.HIGH < freq.LOW && freq.HIGH < freq.MEDIUM) lowVolGroup = 'HIGH';
        else lowVolGroup = 'TIE';
        
        console.log(`   🎯 MEDIAN Group: ${medianGroup}`);
        console.log(`   🎯 HIGH-VOLUME: ${highVolGroup}`);
        console.log(`   🎯 LOW-VOLUME: ${lowVolGroup}`);
    } else {
        console.log(`   ⚠️ Need ${10 - resultCount} more results for prediction`);
    }
    console.log('');
}

// ============ API ENDPOINTS ============

app.get('/api/all-data', async (req, res) => {
    try {
        const [results, predictions, stats, aiStats, currentPrediction] = await Promise.all([
            getResultsData(100),
            getPredictionsData(500),
            getStatsData(),
            getAIStatsData(),
            getCurrentPredictionData()
        ]);
        
        results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        const last10Results = await getLast10Results();
        const last10Groups = last10Results.map(r => r.group);
        const aiStatus = serverAI ? serverAI.getStatus() : null;
        
        res.json({
            success: true,
            results: results,
            predictions: predictions,
            stats: stats,
            aiStats: aiStats,
            currentPrediction: currentPrediction,
            last10Groups: last10Groups,
            aiStatus: aiStatus
        });
    } catch (error) {
        console.error('Error loading all data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/predictions', (req, res) => {
    const limit = parseInt(req.query.limit) || 500;
    
    db.all(`SELECT p.*, r.total, r.dice_values, r.timestamp as result_time
            FROM predictions p
            LEFT JOIN results r ON p.result_id = r.id
            WHERE p.predicted_group IS NOT NULL 
              AND p.predicted_group != 'WAITING'
            ORDER BY p.prediction_timestamp DESC LIMIT ?`, [limit], (err, predictions) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        const transformed = predictions.map(p => ({
            result_id: p.result_id,
            total: p.total || null,
            actual_group: p.actual_group || null,
            dice_values: p.dice_values || null,
            result_time: p.result_time || null,
            protection_type: p.protection_type || 'TRIPLE_AI',
            predicted_group: p.predicted_group,
            predicted_high_vol: p.predicted_high_vol,
            predicted_low_vol: p.predicted_low_vol,
            is_correct: p.is_correct,
            is_high_vol_correct: p.is_high_vol_correct,
            is_low_vol_correct: p.is_low_vol_correct,
            is_retry: p.is_retry === 1,
            retry_number: p.retry_number || 0,
            median_value: p.median_value,
            confidence: p.confidence,
            confidence_high_vol: p.confidence_high_vol,
            confidence_low_vol: p.confidence_low_vol,
            prediction_timestamp: p.prediction_timestamp,
            is_pending: p.actual_group === null
        }));
        
        res.json(transformed);
    });
});

app.get('/api/results', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    db.all(`SELECT * FROM results ORDER BY timestamp DESC LIMIT ? OFFSET ?`, [limit, offset], (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        db.get(`SELECT COUNT(*) as total FROM results`, (err, count) => {
            res.json({
                data: results,
                pagination: {
                    page: page,
                    limit: limit,
                    total: count ? count.total : 0,
                    pages: Math.ceil((count ? count.total : 0) / limit)
                }
            });
        });
    });
});

app.get('/api/stats', (req, res) => {
    db.get(`SELECT 
                COUNT(*) as total_rounds,
                AVG(total) as avg_result,
                (SELECT group_name FROM results GROUP BY group_name ORDER BY COUNT(*) DESC LIMIT 1) as most_active_group
            FROM results`, (err, stats) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        db.get(`SELECT COUNT(*) as lightning_count FROM results WHERE multiplier > 10`, (err, lightning) => {
            db.get(`SELECT COUNT(*) as total FROM results`, (err, total) => {
                const lightningPercent = total && total.total > 0 ? (lightning.lightning_count / total.total) * 100 : 0;
                res.json({
                    totalRounds: stats ? stats.total_rounds : 0,
                    avgResult: stats ? stats.avg_result.toFixed(2) : 0,
                    mostActiveGroup: stats ? stats.most_active_group : 'LOW',
                    lightningBoost: Math.round(lightningPercent)
                });
            });
        });
    });
});

app.get('/api/ai-stats', (req, res) => {
    const aiStatus = serverAI ? serverAI.getStats() : null;
    res.json(aiStatus || { total_predictions: 0, correct_predictions: 0, accuracy: 0 });
});

app.get('/api/current-prediction', async (req, res) => {
    const prediction = await getCurrentPredictionData();
    res.json({
        success: true,
        prediction: prediction
    });
});

app.get('/api/last10', async (req, res) => {
    const last10 = await getLast10Results();
    res.json({
        success: true,
        count: last10.length,
        results: last10,
        groups: last10.map(r => r.group)
    });
});

app.get('/api/ai-status', (req, res) => {
    if (serverAI) {
        res.json({
            success: true,
            status: serverAI.getStatus()
        });
    } else {
        res.json({
            success: false,
            message: "AI not initialized"
        });
    }
});

app.post('/api/reset-ai', (req, res) => {
    if (serverAI) {
        const result = serverAI.reset();
        res.json(result);
    } else {
        res.json({ success: false, message: "AI not initialized" });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        version: '14.0',
        timestamp: new Date().toISOString(),
        clients: clients.size,
        uptime: process.uptime(),
        aiReady: serverAI !== null,
        aiActive: serverAI ? serverAI.isPredictionMode() : false,
        telegramActive: telegramBot ? telegramBot.isEnabled : false
    });
});

app.get('/api/diagnostic', async (req, res) => {
    try {
        const resultsCount = await new Promise((resolve) => {
            db.get(`SELECT COUNT(*) as count FROM results`, (err, row) => {
                resolve(row ? row.count : 0);
            });
        });
        
        const predictionsCount = await new Promise((resolve) => {
            db.get(`SELECT COUNT(*) as count FROM predictions WHERE predicted_group IS NOT NULL AND predicted_group != 'WAITING'`, (err, row) => {
                resolve(row ? row.count : 0);
            });
        });
        
        const last10Results = await getLast10Results();
        const frequencies = { LOW: 0, MEDIUM: 0, HIGH: 0 };
        for (const r of last10Results) {
            frequencies[r.group]++;
        }
        
        const sorted = [frequencies.LOW, frequencies.MEDIUM, frequencies.HIGH].sort((a,b) => a-b);
        const median = sorted[1];
        
        let medianGroup = 'UNKNOWN';
        let isUnique = false;
        if (frequencies.LOW === median && frequencies.MEDIUM !== median && frequencies.HIGH !== median) {
            medianGroup = 'LOW';
            isUnique = true;
        } else if (frequencies.MEDIUM === median && frequencies.LOW !== median && frequencies.HIGH !== median) {
            medianGroup = 'MEDIUM';
            isUnique = true;
        } else if (frequencies.HIGH === median && frequencies.LOW !== median && frequencies.MEDIUM !== median) {
            medianGroup = 'HIGH';
            isUnique = true;
        }
        
        res.json({
            success: true,
            version: '14.0',
            database: {
                path: dbPath,
                exists: fs.existsSync(dbPath)
            },
            counts: {
                results: resultsCount,
                validPredictions: predictionsCount
            },
            last10: {
                count: last10Results.length,
                frequencies: frequencies,
                median: median,
                medianGroup: medianGroup,
                canPredict: isUnique && last10Results.length >= 10
            },
            aiStatus: serverAI ? serverAI.getStatus() : null,
            telegram: {
                configured: telegramBot ? telegramBot.isEnabled : false
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start background data collection
setInterval(collectData, 3000);
collectData();

console.log('📊 Background data collection started (every 3 seconds)');
console.log('🤖 Triple Predictor Statistical AI v14.0 active');
console.log('📊 Core Logic: Analyzes last 10 results with THREE predictors');
console.log('   1. MEDIAN (unique median only)');
console.log('   2. HIGH-VOLUME (most frequent)');
console.log('   3. LOW-VOLUME (least frequent)');
console.log('🔌 WebSocket server ready for real-time updates');
console.log('📱 Telegram: Triple notification system');
console.log('📈 v14.0 Features:');
console.log('   - 10-result frequency analysis');
console.log('   - THREE independent predictions');
console.log('   - Shared WAITING on duplicate median');
console.log('   - Shared retry system');
console.log('   - Real-Time learning via database');

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, saving AI state and closing gracefully...');
    if (telegramBot) telegramBot.stopPolling();
    await saveAIState();
    server.close(() => {
        console.log('Server closed');
        db.close(() => {
            console.log('Database connection closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, saving AI state and closing gracefully...');
    if (telegramBot) telegramBot.stopPolling();
    await saveAIState();
    server.close(() => {
        console.log('Server closed');
        db.close(() => {
            console.log('Database connection closed');
            process.exit(0);
        });
    });
});
