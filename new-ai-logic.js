// ============================================================
// new-ai-logic.js (v13.0 - MEDIAN BASED STATISTICAL AI)
// 
// Core Logic:
// - Takes last 30 results
// - Counts frequency of LOW, MEDIUM, HIGH
// - Finds median of [LOW_count, MEDIUM_count, HIGH_count]
// - Prediction ONLY when median is UNIQUE
// - WAITING when duplicate or all equal
// - Retry: Recalculate median with updated data on wrong prediction
// ============================================================

class MedianBasedAI {
    constructor() {
        this.version = "13.0";
        this.name = "Median-Based Statistical AI";
        
        // AI State
        this.isActive = false;           // Currently in prediction mode?
        this.currentPrediction = null;    // Current predicted group (LOW/MEDIUM/HIGH)
        this.consecutiveWrongCount = 0;   // How many wrong predictions in a row
        this.totalPredictions = 0;
        this.correctPredictions = 0;
        this.accuracy = 0;
        
        // Current data state
        this.currentFrequencies = {
            LOW: 0,
            MEDIUM: 0,
            HIGH: 0
        };
        this.last30Results = [];
        this.medianValue = null;
        this.medianGroup = null;
        
        // Waiting state tracking
        this.waitingReason = null;  // "DUPLICATE_MEDIAN" or "INSUFFICIENT_DATA" or "EQUAL_ALL"
        
        // Stats
        this.patternHistory = [];
        
        console.log(`🤖 ${this.name} v${this.version} initialized`);
        console.log(`📊 Core Logic: 30-result median-based prediction with WAITING on duplicates`);
    }
    
    /**
     * Get group from total number
     */
    getGroup(total) {
        const num = parseInt(total);
        if (num >= 3 && num <= 9) return 'LOW';
        if (num >= 10 && num <= 11) return 'MEDIUM';
        if (num >= 12 && num <= 18) return 'HIGH';
        return 'UNKNOWN';
    }
    
    /**
     * Update frequencies from last 30 results
     */
    updateFrequencies(results) {
        this.last30Results = results.slice(-30);
        
        // Reset frequencies
        this.currentFrequencies = {
            LOW: 0,
            MEDIUM: 0,
            HIGH: 0
        };
        
        // Count occurrences
        for (const result of this.last30Results) {
            const group = result.group || this.getGroup(result.total);
            if (group === 'LOW') this.currentFrequencies.LOW++;
            else if (group === 'MEDIUM') this.currentFrequencies.MEDIUM++;
            else if (group === 'HIGH') this.currentFrequencies.HIGH++;
        }
        
        console.log(`📊 Updated frequencies: LOW=${this.currentFrequencies.LOW}, MEDIUM=${this.currentFrequencies.MEDIUM}, HIGH=${this.currentFrequencies.HIGH}`);
        
        return this.currentFrequencies;
    }
    
    /**
     * Calculate median from three numbers
     * Returns: { medianValue, medianGroup, isUnique, duplicateGroups }
     */
    calculateMedian(frequencies) {
        const values = [
            { group: 'LOW', count: frequencies.LOW },
            { group: 'MEDIUM', count: frequencies.MEDIUM },
            { group: 'HIGH', count: frequencies.HIGH }
        ];
        
        // Sort by count
        const sorted = [...values].sort((a, b) => a.count - b.count);
        
        const medianValue = sorted[1].count;
        const medianGroup = sorted[1].group;
        
        // Check if median is unique (no other group has same count)
        const duplicateGroups = values.filter(v => v.count === medianValue);
        const isUnique = duplicateGroups.length === 1;
        
        console.log(`📐 Median calculation: [${sorted[0].count}, ${sorted[1].count}, ${sorted[2].count}] → Median=${medianValue} (${medianGroup}) - Unique: ${isUnique}`);
        
        return {
            medianValue,
            medianGroup,
            isUnique,
            duplicateGroups: duplicateGroups.map(g => g.group),
            sorted: sorted.map(v => ({ group: v.group, count: v.count }))
        };
    }
    
    /**
     * Determine if we should wait or predict
     */
    shouldWait(medianResult) {
        if (!medianResult.isUnique) {
            if (medianResult.duplicateGroups.length === 3) {
                this.waitingReason = "ALL_GROUPS_EQUAL";
                console.log(`⏳ WAITING: All three groups have equal frequency (${medianResult.medianValue} each)`);
            } else {
                this.waitingReason = "DUPLICATE_MEDIAN";
                console.log(`⏳ WAITING: Median value ${medianResult.medianValue} appears in multiple groups: ${medianResult.duplicateGroups.join(', ')}`);
            }
            return true;
        }
        
        this.waitingReason = null;
        return false;
    }
    
    /**
     * Get trend analysis for a group (for UI display)
     */
    getTrend(group, frequencies, last10Results) {
        // Count in last 10
        const last10Count = last10Results.filter(r => {
            const g = r.group || this.getGroup(r.total);
            return g === group;
        }).length;
        
        const totalCount = frequencies[group];
        const expectedIn10 = (totalCount / 30) * 10;
        
        const difference = last10Count - expectedIn10;
        
        if (difference >= 2) return { emoji: "🔥", text: "Hot streak", intensity: 3 };
        if (difference >= 1) return { emoji: "📈", text: "Warming up", intensity: 2 };
        if (difference <= -2) return { emoji: "💀", text: "Ice cold", intensity: -3 };
        if (difference <= -1) return { emoji: "❄️", text: "Cooling down", intensity: -2 };
        return { emoji: "⚖️", text: "Average", intensity: 0 };
    }
    
    /**
     * Get formatted statistics for display
     */
    getFormattedStats(frequencies, last10Results) {
        const total = frequencies.LOW + frequencies.MEDIUM + frequencies.HIGH;
        
        return {
            LOW: {
                count: frequencies.LOW,
                percentage: ((frequencies.LOW / total) * 100).toFixed(1),
                trend: this.getTrend('LOW', frequencies, last10Results)
            },
            MEDIUM: {
                count: frequencies.MEDIUM,
                percentage: ((frequencies.MEDIUM / total) * 100).toFixed(1),
                trend: this.getTrend('MEDIUM', frequencies, last10Results)
            },
            HIGH: {
                count: frequencies.HIGH,
                percentage: ((frequencies.HIGH / total) * 100).toFixed(1),
                trend: this.getTrend('HIGH', frequencies, last10Results)
            }
        };
    }
    
    /**
     * MAIN PREDICTION FUNCTION
     * @param {Array} last30Results - Array of last 30 results (each with .group or .total)
     * @returns {Object} Prediction result
     */
    predict(last30Results) {
        // Update frequencies
        const frequencies = this.updateFrequencies(last30Results);
        
        // Get last 10 for trend analysis
        const last10Results = this.last30Results.slice(-10);
        
        // Calculate median
        const medianResult = this.calculateMedian(frequencies);
        this.medianValue = medianResult.medianValue;
        this.medianGroup = medianResult.medianGroup;
        
        // Get formatted stats for UI
        const formattedStats = this.getFormattedStats(frequencies, last10Results);
        
        // Check if we should wait
        if (this.shouldWait(medianResult)) {
            // If we were in active prediction mode, deactivate
            if (this.isActive) {
                console.log(`⚠️ WAITING condition met, deactivating prediction mode`);
                this.isActive = false;
                this.currentPrediction = null;
            }
            
            return {
                status: "WAITING",
                waitingReason: this.waitingReason,
                frequencies: frequencies,
                stats: formattedStats,
                medianResult: medianResult,
                predictedGroup: null,
                confidence: 0,
                message: `WAITING: ${this.getWaitingMessage()}`,
                waitingForData: true,
                last30Count: this.last30Results.length,
                isRetry: false,
                retryCount: 0
            };
        }
        
        // We have a unique median - make prediction
        const predictedGroup = medianResult.medianGroup;
        const confidence = this.calculateConfidence(frequencies, medianResult);
        
        // Check if this is a retry (same as previous prediction)
        const isRetry = (this.isActive && this.currentPrediction === predictedGroup);
        const retryCount = isRetry ? this.consecutiveWrongCount : 0;
        
        // Update state
        if (!this.isActive) {
            // New prediction mode starting
            this.isActive = true;
            this.currentPrediction = predictedGroup;
            this.consecutiveWrongCount = 0;
            console.log(`🎯 ACTIVATING PREDICTION MODE: Predicting ${predictedGroup} (Median=${medianResult.medianValue})`);
        } else if (this.currentPrediction !== predictedGroup) {
            // Prediction changed
            console.log(`🔄 Prediction changed from ${this.currentPrediction} to ${predictedGroup}`);
            this.currentPrediction = predictedGroup;
            this.consecutiveWrongCount = 0;
        } else {
            // Same prediction (retry scenario)
            console.log(`🔄 RETAINING prediction: ${predictedGroup} (Retry #${this.consecutiveWrongCount + 1})`);
        }
        
        const prediction = {
            status: "PREDICTION_READY",
            predictedGroup: predictedGroup,
            medianValue: medianResult.medianValue,
            medianGroup: medianResult.medianGroup,
            frequencies: frequencies,
            stats: formattedStats,
            confidence: confidence,
            waitingForData: false,
            isRetry: isRetry,
            retryCount: this.consecutiveWrongCount,
            message: this.getPredictionMessage(predictedGroup, medianResult, isRetry, this.consecutiveWrongCount),
            last30Count: this.last30Results.length,
            medianCalculation: medianResult.sorted
        };
        
        // Record prediction
        this.recordPrediction(prediction);
        
        return prediction;
    }
    
    /**
     * Calculate confidence based on frequency spread
     */
    calculateConfidence(frequencies, medianResult) {
        const values = [frequencies.LOW, frequencies.MEDIUM, frequencies.HIGH];
        const max = Math.max(...values);
        const min = Math.min(...values);
        const spread = max - min;
        
        // Base confidence on how dominant the median is
        const medianCount = medianResult.medianValue;
        const total = frequencies.LOW + frequencies.MEDIUM + frequencies.HIGH;
        const medianPercentage = (medianCount / total) * 100;
        
        let confidence = 50 + (medianPercentage - 33.3) * 1.5;
        confidence = Math.min(92, Math.max(35, confidence));
        
        return Math.round(confidence);
    }
    
    /**
     * Update AI with actual result
     */
    updateWithResult(actualGroup, newResults) {
        const wasActive = this.isActive;
        const wasPredicting = this.currentPrediction;
        const wasWrongCount = this.consecutiveWrongCount;
        
        // Check if prediction was correct
        const isCorrect = (this.currentPrediction === actualGroup);
        
        this.totalPredictions++;
        if (isCorrect) {
            this.correctPredictions++;
            console.log(`✅ CORRECT PREDICTION! ${this.currentPrediction} → ${actualGroup}`);
            
            // Reset state
            this.isActive = false;
            this.currentPrediction = null;
            this.consecutiveWrongCount = 0;
            
            // Update accuracy
            this.accuracy = (this.correctPredictions / this.totalPredictions) * 100;
            
            return {
                isCorrect: true,
                predictedGroup: wasPredicting,
                actualGroup: actualGroup,
                wasRetry: wasWrongCount > 0,
                retryCount: wasWrongCount,
                newAccuracy: this.accuracy,
                resetMode: true,
                message: `✅ Correct! Reset to WAITING mode.`
            };
        } else {
            // Wrong prediction
            this.consecutiveWrongCount++;
            console.log(`❌ WRONG PREDICTION! ${this.currentPrediction} → ${actualGroup} (Wrong count: ${this.consecutiveWrongCount})`);
            
            // Keep active mode, but prediction will be recalculated on next call
            // Note: We don't change currentPrediction here - it will be recalculated
            // when predict() is called again with updated data
            
            this.accuracy = (this.correctPredictions / this.totalPredictions) * 100;
            
            return {
                isCorrect: false,
                predictedGroup: wasPredicting,
                actualGroup: actualGroup,
                wasRetry: wasWrongCount > 0,
                retryCount: this.consecutiveWrongCount,
                newAccuracy: this.accuracy,
                keepActive: true,
                message: `❌ Wrong! Retaining prediction mode. Retry #${this.consecutiveWrongCount}`
            };
        }
    }
    
    /**
     * Get waiting message
     */
    getWaitingMessage() {
        switch(this.waitingReason) {
            case "ALL_GROUPS_EQUAL":
                return "All three groups have equal frequency. Waiting for next result to break the tie.";
            case "DUPLICATE_MEDIAN":
                return "Median value appears in multiple groups. Waiting for next result to create unique median.";
            default:
                return "Insufficient data or waiting for unique median condition.";
        }
    }
    
    /**
     * Get prediction message
     */
    getPredictionMessage(predictedGroup, medianResult, isRetry, retryCount) {
        const retryText = isRetry ? ` (Retry #${retryCount + 1} after wrong prediction)` : '';
        
        return `🎯 Predicting ${predictedGroup} based on median frequency (${medianResult.medianValue} occurrences)${retryText}. Next round expected to be ${predictedGroup}.`;
    }
    
    /**
     * Record prediction for history
     */
    recordPrediction(prediction) {
        this.patternHistory.unshift({
            timestamp: new Date().toISOString(),
            ...prediction,
            id: Date.now()
        });
        
        // Keep last 1000
        if (this.patternHistory.length > 1000) {
            this.patternHistory.pop();
        }
    }
    
    /**
     * Get current AI status
     */
    getStatus() {
        return {
            version: this.version,
            name: this.name,
            isActive: this.isActive,
            currentPrediction: this.currentPrediction,
            consecutiveWrongCount: this.consecutiveWrongCount,
            totalPredictions: this.totalPredictions,
            correctPredictions: this.correctPredictions,
            accuracy: this.accuracy,
            waitingReason: this.waitingReason,
            currentFrequencies: this.currentFrequencies,
            medianValue: this.medianValue,
            medianGroup: this.medianGroup,
            last30Count: this.last30Results.length
        };
    }
    
    /**
     * Get current frequencies
     */
    getCurrentFrequencies() {
        return {
            frequencies: this.currentFrequencies,
            last30Count: this.last30Results.length
        };
    }
    
    /**
     * Check if AI is in prediction mode
     */
    isPredictionMode() {
        return this.isActive;
    }
    
    /**
     * Reset AI state
     */
    reset() {
        console.log(`🔄 Resetting AI state...`);
        this.isActive = false;
        this.currentPrediction = null;
        this.consecutiveWrongCount = 0;
        this.waitingReason = null;
        this.medianValue = null;
        this.medianGroup = null;
        
        return {
            success: true,
            message: "AI reset to WAITING mode"
        };
    }
    
    /**
     * Export state for persistence
     */
    exportState() {
        return {
            version: this.version,
            totalPredictions: this.totalPredictions,
            correctPredictions: this.correctPredictions,
            accuracy: this.accuracy,
            patternHistory: this.patternHistory.slice(0, 100),
            lastState: {
                isActive: this.isActive,
                currentPrediction: this.currentPrediction,
                consecutiveWrongCount: this.consecutiveWrongCount
            }
        };
    }
    
    /**
     * Load state from persistence
     */
    loadState(state) {
        if (!state) return;
        
        this.version = state.version || this.version;
        this.totalPredictions = state.totalPredictions || 0;
        this.correctPredictions = state.correctPredictions || 0;
        this.accuracy = state.accuracy || 0;
        
        if (state.patternHistory) {
            this.patternHistory = state.patternHistory;
        }
        
        if (state.lastState) {
            this.isActive = state.lastState.isActive || false;
            this.currentPrediction = state.lastState.currentPrediction || null;
            this.consecutiveWrongCount = state.lastState.consecutiveWrongCount || 0;
        }
        
        console.log(`📀 AI state loaded: ${this.totalPredictions} predictions, ${this.accuracy.toFixed(1)}% accuracy`);
    }
    
    /**
     * Get stats for API
     */
    getStats() {
        return {
            name: this.name,
            version: this.version,
            totalPredictions: this.totalPredictions,
            correctPredictions: this.correctPredictions,
            accuracy: this.accuracy,
            isActive: this.isActive,
            currentPrediction: this.currentPrediction,
            consecutiveWrongCount: this.consecutiveWrongCount,
            waitingReason: this.waitingReason,
            currentFrequencies: this.currentFrequencies
        };
    }
    
    /**
     * Get accuracy
     */
    getAccuracy() {
        return this.accuracy;
    }
}

// Helper functions for external use
function createMedianFromResults(results) {
    if (!results || results.length < 30) {
        return null;
    }
    
    const frequencies = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const result of results) {
        const total = result.total || result;
        if (total >= 3 && total <= 9) frequencies.LOW++;
        else if (total >= 10 && total <= 11) frequencies.MEDIUM++;
        else if (total >= 12 && total <= 18) frequencies.HIGH++;
    }
    
    const sorted = [frequencies.LOW, frequencies.MEDIUM, frequencies.HIGH].sort((a,b) => a - b);
    const median = sorted[1];
    
    // Find which group has median
    if (frequencies.LOW === median) return { median, group: 'LOW', frequencies };
    if (frequencies.MEDIUM === median) return { median, group: 'MEDIUM', frequencies };
    return { median, group: 'HIGH', frequencies };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    MedianBasedAI,
    createMedianFromResults
};
