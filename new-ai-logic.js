// ============================================================
// new-ai-logic.js (v14.0 - TRIPLE PREDICTOR AI)
// 
// Core Logic:
// - Takes last 10 results
// - Counts frequency of LOW, MEDIUM, HIGH
// - THREE PREDICTORS:
//   1. MEDIAN: Finds median of [LOW_count, MEDIUM_count, HIGH_count]
//   2. HIGH-VOLUME: Predicts group with HIGHEST frequency
//   3. LOW-VOLUME: Predicts group with LOWEST frequency
// - WAITING when median is duplicate or all equal (ALL predictors WAIT)
// - Retry: Shared retry count for all predictors
// ============================================================

class MedianBasedAI {
    constructor() {
        this.version = "14.0";
        this.name = "Triple Predictor Statistical AI";
        
        // AI State (shared for all predictors)
        this.isActive = false;           // Currently in prediction mode?
        this.currentMedianPrediction = null;    // MEDIAN predictor
        this.currentHighVolPrediction = null;   // HIGH-VOLUME predictor
        this.currentLowVolPrediction = null;    // LOW-VOLUME predictor
        this.consecutiveWrongCount = 0;   // How many wrong predictions in a row (shared)
        this.totalPredictions = 0;
        this.correctPredictions = 0;
        this.accuracy = 0;
        
        // Current data state
        this.currentFrequencies = {
            LOW: 0,
            MEDIUM: 0,
            HIGH: 0
        };
        this.last10Results = [];
        this.medianValue = null;
        this.medianGroup = null;
        
        // Waiting state tracking (shared for all predictors)
        this.waitingReason = null;  // "DUPLICATE_MEDIAN" or "INSUFFICIENT_DATA" or "EQUAL_ALL"
        
        // Stats
        this.patternHistory = [];
        
        console.log(`🤖 ${this.name} v${this.version} initialized`);
        console.log(`📊 Core Logic: 10-result analysis with THREE predictors`);
        console.log(`   1. MEDIAN (unique median prediction)`);
        console.log(`   2. HIGH-VOLUME (most frequent group)`);
        console.log(`   3. LOW-VOLUME (least frequent group)`);
        console.log(`⏳ WAITING condition affects ALL THREE predictors`);
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
     * Update frequencies from last 10 results
     */
    updateFrequencies(results) {
        this.last10Results = results.slice(-10);
        
        // Reset frequencies
        this.currentFrequencies = {
            LOW: 0,
            MEDIUM: 0,
            HIGH: 0
        };
        
        // Count occurrences
        for (const result of this.last10Results) {
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
     * Get HIGH-VOLUME prediction (most frequent group)
     */
    getHighVolumePrediction(frequencies) {
        const values = [
            { group: 'LOW', count: frequencies.LOW },
            { group: 'MEDIUM', count: frequencies.MEDIUM },
            { group: 'HIGH', count: frequencies.HIGH }
        ];
        
        // Sort by count descending
        const sorted = [...values].sort((a, b) => b.count - a.count);
        const highestCount = sorted[0].count;
        
        // Check for ties in highest count
        const ties = values.filter(v => v.count === highestCount);
        const isUnique = ties.length === 1;
        
        return {
            predictedGroup: isUnique ? sorted[0].group : null,
            count: highestCount,
            isUnique: isUnique,
            message: isUnique ? `HIGH-VOLUME: Predicting ${sorted[0].group} (most frequent: ${highestCount} occurrences)` : `HIGH-VOLUME: TIE - waiting`
        };
    }
    
    /**
     * Get LOW-VOLUME prediction (least frequent group)
     */
    getLowVolumePrediction(frequencies) {
        const values = [
            { group: 'LOW', count: frequencies.LOW },
            { group: 'MEDIUM', count: frequencies.MEDIUM },
            { group: 'HIGH', count: frequencies.HIGH }
        ];
        
        // Sort by count ascending
        const sorted = [...values].sort((a, b) => a.count - b.count);
        const lowestCount = sorted[0].count;
        
        // Check for ties in lowest count
        const ties = values.filter(v => v.count === lowestCount);
        const isUnique = ties.length === 1;
        
        return {
            predictedGroup: isUnique ? sorted[0].group : null,
            count: lowestCount,
            isUnique: isUnique,
            message: isUnique ? `LOW-VOLUME: Predicting ${sorted[0].group} (least frequent: ${lowestCount} occurrences)` : `LOW-VOLUME: TIE - waiting`
        };
    }
    
    /**
     * Determine if we should wait or predict (SHARED for ALL predictors)
     * Based on MEDIAN uniqueness (as per original logic)
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
        const expectedIn10 = (totalCount / 10) * 10;
        
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
     * Calculate confidence for MEDIAN predictor
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
     * Calculate confidence for HIGH-VOLUME predictor
     */
    calculateHighVolConfidence(frequencies, highVolResult) {
        if (!highVolResult.isUnique) return 0;
        
        const total = frequencies.LOW + frequencies.MEDIUM + frequencies.HIGH;
        const percentage = (highVolResult.count / total) * 100;
        
        let confidence = 40 + (percentage - 33.3) * 1.2;
        confidence = Math.min(85, Math.max(30, confidence));
        
        return Math.round(confidence);
    }
    
    /**
     * Calculate confidence for LOW-VOLUME predictor
     */
    calculateLowVolConfidence(frequencies, lowVolResult) {
        if (!lowVolResult.isUnique) return 0;
        
        const total = frequencies.LOW + frequencies.MEDIUM + frequencies.HIGH;
        const percentage = (lowVolResult.count / total) * 100;
        
        // Lower frequency = lower confidence for contrarian bets
        let confidence = 35 + (33.3 - percentage) * 0.8;
        confidence = Math.min(75, Math.max(25, confidence));
        
        return Math.round(confidence);
    }
    
    /**
     * MAIN PREDICTION FUNCTION - Returns ALL THREE predictions
     * @param {Array} last10Results - Array of last 10 results (each with .group or .total)
     * @returns {Object} Prediction result with all three predictors
     */
    predict(last10Results) {
        // Update frequencies
        const frequencies = this.updateFrequencies(last10Results);
        
        // Get last 10 for trend analysis
        const last10Results = this.last10Results.slice(-10);
        
        // Calculate median
        const medianResult = this.calculateMedian(frequencies);
        this.medianValue = medianResult.medianValue;
        this.medianGroup = medianResult.medianGroup;
        
        // Get HIGH-VOLUME and LOW-VOLUME predictions
        const highVolResult = this.getHighVolumePrediction(frequencies);
        const lowVolResult = this.getLowVolumePrediction(frequencies);
        
        // Get formatted stats for UI
        const formattedStats = this.getFormattedStats(frequencies, last10Results);
        
        // Check if we should wait (SHARED condition based on MEDIAN)
        if (this.shouldWait(medianResult)) {
            // If we were in active prediction mode, deactivate ALL
            if (this.isActive) {
                console.log(`⚠️ WAITING condition met, deactivating ALL prediction modes`);
                this.isActive = false;
                this.currentMedianPrediction = null;
                this.currentHighVolPrediction = null;
                this.currentLowVolPrediction = null;
            }
            
            return {
                status: "WAITING",
                waitingReason: this.waitingReason,
                frequencies: frequencies,
                stats: formattedStats,
                medianResult: medianResult,
                // ALL three predictors are WAITING
                median: {
                    status: "WAITING",
                    predictedGroup: null,
                    confidence: 0,
                    message: `WAITING: ${this.getWaitingMessage()}`
                },
                highVolume: {
                    status: "WAITING",
                    predictedGroup: null,
                    confidence: 0,
                    message: `WAITING: Median condition not met`
                },
                lowVolume: {
                    status: "WAITING",
                    predictedGroup: null,
                    confidence: 0,
                    message: `WAITING: Median condition not met`
                },
                waitingForData: true,
                last10Count: this.last10Results.length,
                isRetry: false,
                retryCount: 0
            };
        }
        
        // NOT WAITING - make ALL THREE predictions
        
        // 1. MEDIAN prediction
        const medianPredictedGroup = medianResult.medianGroup;
        const medianConfidence = this.calculateConfidence(frequencies, medianResult);
        
        // 2. HIGH-VOLUME prediction
        const highVolPredictedGroup = highVolResult.isUnique ? highVolResult.predictedGroup : null;
        const highVolConfidence = highVolResult.isUnique ? this.calculateHighVolConfidence(frequencies, highVolResult) : 0;
        
        // 3. LOW-VOLUME prediction
        const lowVolPredictedGroup = lowVolResult.isUnique ? lowVolResult.predictedGroup : null;
        const lowVolConfidence = lowVolResult.isUnique ? this.calculateLowVolConfidence(frequencies, lowVolResult) : 0;
        
        // Check if this is a retry (shared for all)
        const isRetry = (this.isActive && this.currentMedianPrediction === medianPredictedGroup);
        const retryCount = isRetry ? this.consecutiveWrongCount : 0;
        
        // Update state
        if (!this.isActive) {
            // New prediction mode starting
            this.isActive = true;
            this.currentMedianPrediction = medianPredictedGroup;
            this.currentHighVolPrediction = highVolPredictedGroup;
            this.currentLowVolPrediction = lowVolPredictedGroup;
            this.consecutiveWrongCount = 0;
            console.log(`🎯 ACTIVATING PREDICTION MODE:`);
            console.log(`   MEDIAN: ${medianPredictedGroup} (Median=${medianResult.medianValue})`);
            console.log(`   HIGH-VOLUME: ${highVolPredictedGroup} (Count=${highVolResult.count})`);
            console.log(`   LOW-VOLUME: ${lowVolPredictedGroup} (Count=${lowVolResult.count})`);
        } else if (this.currentMedianPrediction !== medianPredictedGroup) {
            // Median prediction changed
            console.log(`🔄 MEDIAN prediction changed from ${this.currentMedianPrediction} to ${medianPredictedGroup}`);
            this.currentMedianPrediction = medianPredictedGroup;
            this.currentHighVolPrediction = highVolPredictedGroup;
            this.currentLowVolPrediction = lowVolPredictedGroup;
            this.consecutiveWrongCount = 0;
        } else {
            // Same predictions (retry scenario)
            console.log(`🔄 RETAINING predictions (Retry #${this.consecutiveWrongCount + 1})`);
        }
        
        const prediction = {
            status: "PREDICTION_READY",
            waitingReason: null,
            frequencies: frequencies,
            stats: formattedStats,
            medianResult: medianResult,
            // ALL THREE predictions
            median: {
                status: "ACTIVE",
                predictedGroup: medianPredictedGroup,
                confidence: medianConfidence,
                message: this.getPredictionMessage(medianPredictedGroup, medianResult, isRetry, this.consecutiveWrongCount)
            },
            highVolume: {
                status: highVolResult.isUnique ? "ACTIVE" : "TIE",
                predictedGroup: highVolPredictedGroup,
                confidence: highVolConfidence,
                count: highVolResult.count,
                message: highVolResult.message
            },
            lowVolume: {
                status: lowVolResult.isUnique ? "ACTIVE" : "TIE",
                predictedGroup: lowVolPredictedGroup,
                confidence: lowVolConfidence,
                count: lowVolResult.count,
                message: lowVolResult.message
            },
            waitingForData: false,
            isRetry: isRetry,
            retryCount: this.consecutiveWrongCount,
            last10Count: this.last10Results.length,
            medianCalculation: medianResult.sorted
        };
        
        // Record prediction
        this.recordPrediction(prediction);
        
        return prediction;
    }
    
    /**
     * Update AI with actual result (SHARED retry system)
     * Checks which predictions were correct (MEDIAN only for activation)
     */
    updateWithResult(actualGroup, newResults) {
        const wasActive = this.isActive;
        const wasMedianPrediction = this.currentMedianPrediction;
        const wasHighVolPrediction = this.currentHighVolPrediction;
        const wasLowVolPrediction = this.currentLowVolPrediction;
        const wasWrongCount = this.consecutiveWrongCount;
        
        // Check MEDIAN prediction correctness (this determines activation)
        const isMedianCorrect = (this.currentMedianPrediction === actualGroup);
        
        this.totalPredictions++;
        if (isMedianCorrect) {
            this.correctPredictions++;
            console.log(`✅ CORRECT MEDIAN PREDICTION! ${this.currentMedianPrediction} → ${actualGroup}`);
            
            // Reset state
            this.isActive = false;
            this.currentMedianPrediction = null;
            this.currentHighVolPrediction = null;
            this.currentLowVolPrediction = null;
            this.consecutiveWrongCount = 0;
            
            // Update accuracy
            this.accuracy = (this.correctPredictions / this.totalPredictions) * 100;
            
            return {
                isCorrect: true,
                medianCorrect: true,
                highVolCorrect: (wasHighVolPrediction === actualGroup),
                lowVolCorrect: (wasLowVolPrediction === actualGroup),
                predictedGroups: {
                    median: wasMedianPrediction,
                    highVolume: wasHighVolPrediction,
                    lowVolume: wasLowVolPrediction
                },
                actualGroup: actualGroup,
                wasRetry: wasWrongCount > 0,
                retryCount: wasWrongCount,
                newAccuracy: this.accuracy,
                resetMode: true,
                message: `✅ Median correct! Reset to WAITING mode.`
            };
        } else {
            // Wrong MEDIAN prediction (shared retry)
            this.consecutiveWrongCount++;
            console.log(`❌ WRONG MEDIAN PREDICTION! ${this.currentMedianPrediction} → ${actualGroup}`);
            console.log(`   HIGH-VOLUME: ${wasHighVolPrediction} (${wasHighVolPrediction === actualGroup ? '✓' : '✗'})`);
            console.log(`   LOW-VOLUME: ${wasLowVolPrediction} (${wasLowVolPrediction === actualGroup ? '✓' : '✗'})`);
            console.log(`   Shared Wrong count: ${this.consecutiveWrongCount}`);
            
            this.accuracy = (this.correctPredictions / this.totalPredictions) * 100;
            
            return {
                isCorrect: false,
                medianCorrect: false,
                highVolCorrect: (wasHighVolPrediction === actualGroup),
                lowVolCorrect: (wasLowVolPrediction === actualGroup),
                predictedGroups: {
                    median: wasMedianPrediction,
                    highVolume: wasHighVolPrediction,
                    lowVolume: wasLowVolPrediction
                },
                actualGroup: actualGroup,
                wasRetry: wasWrongCount > 0,
                retryCount: this.consecutiveWrongCount,
                newAccuracy: this.accuracy,
                keepActive: true,
                message: `❌ Median wrong! Shared retry #${this.consecutiveWrongCount}`
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
     * Get prediction message for MEDIAN
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
            currentMedianPrediction: this.currentMedianPrediction,
            currentHighVolPrediction: this.currentHighVolPrediction,
            currentLowVolPrediction: this.currentLowVolPrediction,
            consecutiveWrongCount: this.consecutiveWrongCount,
            totalPredictions: this.totalPredictions,
            correctPredictions: this.correctPredictions,
            accuracy: this.accuracy,
            waitingReason: this.waitingReason,
            currentFrequencies: this.currentFrequencies,
            medianValue: this.medianValue,
            medianGroup: this.medianGroup,
            last10Count: this.last10Results.length
        };
    }
    
    /**
     * Get current frequencies
     */
    getCurrentFrequencies() {
        return {
            frequencies: this.currentFrequencies,
            last10Count: this.last10Results.length
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
        this.currentMedianPrediction = null;
        this.currentHighVolPrediction = null;
        this.currentLowVolPrediction = null;
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
                currentMedianPrediction: this.currentMedianPrediction,
                currentHighVolPrediction: this.currentHighVolPrediction,
                currentLowVolPrediction: this.currentLowVolPrediction,
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
            this.currentMedianPrediction = state.lastState.currentMedianPrediction || null;
            this.currentHighVolPrediction = state.lastState.currentHighVolPrediction || null;
            this.currentLowVolPrediction = state.lastState.currentLowVolPrediction || null;
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
            currentMedianPrediction: this.currentMedianPrediction,
            currentHighVolPrediction: this.currentHighVolPrediction,
            currentLowVolPrediction: this.currentLowVolPrediction,
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
    if (!results || results.length < 10) {
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
