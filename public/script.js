// ============================================================
// COMPLETE script.js (UPDATED FOR v14.0 - TRIPLE PREDICTOR AI)
// Features: 
// - THREE predictions: MEDIAN, HIGH-VOLUME, LOW-VOLUME
// - Shared WAITING display
// - Color-coded history (green = correct, red = wrong)
// - Fixed: Actual group display, Retry in all columns
// - Trend analysis
// ============================================================

class LightningDiceApp {
    constructor() {
        this.apiBase = '/api';
        this.ws = null;
        this.allResults = [];
        this.predictionHistory = [];
        this.currentPrediction = null;
        this.currentPage = 1;
        this.itemsPerPage = 10;
        this.isInitialized = false;
        this.last10Groups = [];
        this.autoRefreshInterval = null;
        this.autoRefreshEnabled = true;
        this.refreshTimer = 3;
        
        this.groups = {
            LOW: { name: 'LOW', range: '3-9', numbers: [3,4,5,6,7,8,9], icon: '🔴', color: '#ef4444' },
            MEDIUM: { name: 'MEDIUM', range: '10-11', numbers: [10,11], icon: '🟡', color: '#fbbf24' },
            HIGH: { name: 'HIGH', range: '12-18', numbers: [12,13,14,15,16,17,18], icon: '🟢', color: '#4ade80' }
        };
        
        this.init();
    }
    
    async init() {
        console.log('🚀 Initializing Triple Predictor Statistical AI System v14.0...');
        this.bindEvents();
        this.setupAutoRefresh();
        
        await this.loadInitialData();
        this.setupWebSocket();
        this.setupCollapsibleStats();
        this.isInitialized = true;
    }
    
    async loadInitialData() {
        console.log('📥 Loading initial data...');
        
        try {
            const response = await fetch(`${this.apiBase}/all-data`);
            if (!response.ok) throw new Error('Failed to load initial data');
            const data = await response.json();
            
            // Sort results by timestamp descending (newest first)
            this.allResults = (data.results || []).sort((a, b) => {
                return new Date(b.timestamp) - new Date(a.timestamp);
            });
            
            // Filter out WAITING predictions from history
            this.predictionHistory = (data.predictions || []).filter(p => {
                return p.predictedGroup && 
                       p.predictedGroup !== 'WAITING' && 
                       p.predictedGroup !== '--';
            });
            this.currentPrediction = data.currentPrediction || null;
            this.last10Groups = data.last10Groups || [];
            
            console.log(`✅ Filtered prediction history: ${this.predictionHistory.length} valid predictions`);
            console.log(`📊 Last 10 groups: ${this.last10Groups.join(' → ')}`);
            
            this.displayPrediction(this.currentPrediction);
            this.renderHistoryTable();
            this.updateRecentResultsDisplay();
            this.updateStatisticsTable();
            this.updateGroupProbabilities();
            this.updateStatsDisplay(data.stats);
            this.updateLast10Display();
            this.updateTripleDisplay();
            
            console.log(`✅ Initial data loaded: ${this.allResults.length} results, ${this.predictionHistory.length} valid predictions`);
        } catch (error) {
            console.error('Error loading initial data:', error);
            setTimeout(() => this.loadInitialData(), 2000);
        }
    }
    
    updateLast10Display() {
        const container = document.getElementById('last10Groups');
        const countContainer = document.getElementById('last10Count');
        
        if (!container) return;
        
        if (this.last10Groups && this.last10Groups.length > 0) {
            const groupsHtml = this.last10Groups.map(g => {
                const icon = this.getGroupIcon(g);
                return `<span class="group-chip ${g.toLowerCase()}">${icon} ${g}</span>`;
            }).join('');
            
            container.innerHTML = groupsHtml;
            if (countContainer) {
                countContainer.textContent = `${this.last10Groups.length}/10`;
            }
        } else {
            container.innerHTML = '<span class="waiting-text">Collecting data... (need 10 results)</span>';
            if (countContainer) {
                countContainer.textContent = `${this.allResults.length}/10`;
            }
        }
    }
    
    updateTripleDisplay() {
        // Update median display elements
        const medianValueEl = document.getElementById('medianValue');
        const frequenciesEl = document.getElementById('frequencies');
        
        // Update triple predictor displays
        const medianPredictionEl = document.getElementById('medianPrediction');
        const highVolPredictionEl = document.getElementById('highVolPrediction');
        const lowVolPredictionEl = document.getElementById('lowVolPrediction');
        
        const medianConfidenceEl = document.getElementById('medianConfidence');
        const highVolConfidenceEl = document.getElementById('highVolConfidence');
        const lowVolConfidenceEl = document.getElementById('lowVolConfidence');
        
        if (!this.currentPrediction) {
            if (medianValueEl) medianValueEl.textContent = '--';
            if (frequenciesEl) frequenciesEl.textContent = '-- → -- → --';
            if (medianPredictionEl) medianPredictionEl.innerHTML = '<span class="waiting-text">--</span>';
            if (highVolPredictionEl) highVolPredictionEl.innerHTML = '<span class="waiting-text">--</span>';
            if (lowVolPredictionEl) lowVolPredictionEl.innerHTML = '<span class="waiting-text">--</span>';
            return;
        }
        
        const stats = this.currentPrediction.stats;
        if (stats) {
            const frequencies = `${stats.LOW.count} → ${stats.MEDIUM.count} → ${stats.HIGH.count}`;
            if (frequenciesEl) frequenciesEl.textContent = frequencies;
            
            const sorted = [stats.LOW.count, stats.MEDIUM.count, stats.HIGH.count].sort((a,b) => a-b);
            const median = sorted[1];
            if (medianValueEl) medianValueEl.textContent = median;
        }
        
        // Check if waiting mode
        if (this.currentPrediction.status === 'WAITING') {
            if (medianPredictionEl) medianPredictionEl.innerHTML = '<span class="waiting-text">⏳ WAITING</span>';
            if (highVolPredictionEl) highVolPredictionEl.innerHTML = '<span class="waiting-text">⏳ WAITING</span>';
            if (lowVolPredictionEl) lowVolPredictionEl.innerHTML = '<span class="waiting-text">⏳ WAITING</span>';
            if (medianConfidenceEl) medianConfidenceEl.textContent = '0%';
            if (highVolConfidenceEl) highVolConfidenceEl.textContent = '0%';
            if (lowVolConfidenceEl) lowVolConfidenceEl.textContent = '0%';
            return;
        }
        
        // PREDICTION_READY - show all three predictions
        const median = this.currentPrediction.median;
        const highVolume = this.currentPrediction.highVolume;
        const lowVolume = this.currentPrediction.lowVolume;
        
        if (median && medianPredictionEl) {
            medianPredictionEl.innerHTML = `${this.getGroupIcon(median.predictedGroup)} ${median.predictedGroup}`;
            if (medianConfidenceEl) medianConfidenceEl.textContent = `${median.confidence}%`;
        }
        
        if (highVolume && highVolPredictionEl) {
            if (highVolume.status === 'ACTIVE') {
                highVolPredictionEl.innerHTML = `${this.getGroupIcon(highVolume.predictedGroup)} ${highVolume.predictedGroup}`;
                if (highVolConfidenceEl) highVolConfidenceEl.textContent = `${highVolume.confidence}%`;
            } else if (highVolume.status === 'TIE') {
                highVolPredictionEl.innerHTML = '<span class="waiting-text">⚖️ TIE</span>';
                if (highVolConfidenceEl) highVolConfidenceEl.textContent = '0%';
            } else {
                highVolPredictionEl.innerHTML = '<span class="waiting-text">--</span>';
                if (highVolConfidenceEl) highVolConfidenceEl.textContent = '0%';
            }
        }
        
        if (lowVolume && lowVolPredictionEl) {
            if (lowVolume.status === 'ACTIVE') {
                lowVolPredictionEl.innerHTML = `${this.getGroupIcon(lowVolume.predictedGroup)} ${lowVolume.predictedGroup}`;
                if (lowVolConfidenceEl) lowVolConfidenceEl.textContent = `${lowVolume.confidence}%`;
            } else if (lowVolume.status === 'TIE') {
                lowVolPredictionEl.innerHTML = '<span class="waiting-text">⚖️ TIE</span>';
                if (lowVolConfidenceEl) lowVolConfidenceEl.textContent = '0%';
            } else {
                lowVolPredictionEl.innerHTML = '<span class="waiting-text">--</span>';
                if (lowVolConfidenceEl) lowVolConfidenceEl.textContent = '0%';
            }
        }
    }
    
    updateGroupProbabilities() {
        if (!this.last10Groups || this.last10Groups.length === 0) {
            const lowProb = document.getElementById('lowProb');
            const mediumProb = document.getElementById('mediumProb');
            const highProb = document.getElementById('highProb');
            if (lowProb) lowProb.textContent = '0% (0/0)';
            if (mediumProb) mediumProb.textContent = '0% (0/0)';
            if (highProb) highProb.textContent = '0% (0/0)';
            return;
        }
        
        const counts = { LOW: 0, MEDIUM: 0, HIGH: 0 };
        for (const group of this.last10Groups) {
            if (group === 'LOW') counts.LOW++;
            else if (group === 'MEDIUM') counts.MEDIUM++;
            else if (group === 'HIGH') counts.HIGH++;
        }
        
        const total = counts.LOW + counts.MEDIUM + counts.HIGH;
        
        const lowProb = document.getElementById('lowProb');
        const mediumProb = document.getElementById('mediumProb');
        const highProb = document.getElementById('highProb');
        const lowTrend = document.getElementById('lowTrend');
        const mediumTrend = document.getElementById('mediumTrend');
        const highTrend = document.getElementById('highTrend');
        
        if (lowProb) lowProb.textContent = `${((counts.LOW / total) * 100).toFixed(1)}% (${counts.LOW}/${total})`;
        if (mediumProb) mediumProb.textContent = `${((counts.MEDIUM / total) * 100).toFixed(1)}% (${counts.MEDIUM}/${total})`;
        if (highProb) highProb.textContent = `${((counts.HIGH / total) * 100).toFixed(1)}% (${counts.HIGH}/${total})`;
        
        // Get trends from current prediction if available
        if (this.currentPrediction && this.currentPrediction.stats) {
            const stats = this.currentPrediction.stats;
            if (lowTrend) lowTrend.textContent = `${stats.LOW.trend.emoji} ${stats.LOW.trend.text}`;
            if (mediumTrend) mediumTrend.textContent = `${stats.MEDIUM.trend.emoji} ${stats.MEDIUM.trend.text}`;
            if (highTrend) highTrend.textContent = `${stats.HIGH.trend.emoji} ${stats.HIGH.trend.text}`;
        } else {
            if (lowTrend) lowTrend.textContent = '⚖️ Analyzing';
            if (mediumTrend) mediumTrend.textContent = '⚖️ Analyzing';
            if (highTrend) highTrend.textContent = '⚖️ Analyzing';
        }
    }
    
    displayPrediction(prediction) {
        if (!prediction) {
            console.log('⚠️ No prediction data available');
            this.showWaitingState();
            return;
        }
        
        this.currentPrediction = prediction;
        
        // Update elements
        const predictionStatusEl = document.getElementById('predictionStatus');
        const activeModelDisplay = document.getElementById('activeModelDisplay');
        
        // Final prediction card
        const finalIcon = document.getElementById('finalIcon');
        const finalName = document.getElementById('finalName');
        const finalRange = document.getElementById('finalRange');
        const confidenceFill = document.getElementById('confidenceFill');
        const finalConfidence = document.getElementById('finalConfidence');
        const finalExplanation = document.getElementById('finalExplanation');
        const finalWeights = document.getElementById('finalWeights');
        
        // Check if waiting for data
        if (prediction.status === 'WAITING' || prediction.waitingForData) {
            this.showWaitingState();
            return;
        }
        
        // Prediction ready - show MEDIAN as primary
        const median = prediction.median;
        const highVolume = prediction.highVolume;
        const lowVolume = prediction.lowVolume;
        const isRetry = prediction.isRetry || false;
        const retryCount = prediction.retryCount || 0;
        const stats = prediction.stats;
        
        if (predictionStatusEl) predictionStatusEl.innerHTML = '<span class="status-active">🎯 PREDICTION ACTIVE</span>';
        if (activeModelDisplay) activeModelDisplay.innerHTML = '<span class="status-match">TRIPLE AI ACTIVE</span>';
        
        // Final prediction card (shows MEDIAN as primary)
        if (finalIcon) finalIcon.textContent = this.getGroupIcon(median.predictedGroup);
        if (finalName) finalName.textContent = median.predictedGroup;
        if (finalRange) finalRange.textContent = `(${this.getGroupRange(median.predictedGroup)})`;
        if (confidenceFill) confidenceFill.style.width = `${median.confidence}%`;
        if (finalConfidence) finalConfidence.textContent = `${median.confidence}%`;
        
        // Explanation with all three predictions
        const retryText = isRetry ? `<br><span style="color:#fbbf24;">🔄 SHARED RETRY #${retryCount + 1} - Recalculated with updated data</span>` : '';
        
        if (finalExplanation) {
            finalExplanation.innerHTML = `
                <strong>📊 TRIPLE PREDICTOR STATISTICAL AI v14.0</strong><br><br>
                📐 <strong>Last 10 Frequencies:</strong><br>
                🔴 LOW: ${stats.LOW.count} times (${stats.LOW.percentage}%) ${stats.LOW.trend.emoji}<br>
                🟡 MEDIUM: ${stats.MEDIUM.count} times (${stats.MEDIUM.percentage}%) ${stats.MEDIUM.trend.emoji}<br>
                🟢 HIGH: ${stats.HIGH.count} times (${stats.HIGH.percentage}%) ${stats.HIGH.trend.emoji}<br><br>
                📊 <strong>Median Calculation:</strong> ${stats.LOW.count} → ${stats.MEDIUM.count} → ${stats.HIGH.count}<br>
                Median Value: <strong>${prediction.medianValue}</strong><br><br>
                🎯 <strong>THREE PREDICTIONS:</strong><br>
                📐 MEDIAN: <strong style="color:#a78bfa;">${median.predictedGroup}</strong> (${median.confidence}% confidence)<br>
                📈 HIGH-VOLUME: <strong style="color:#4ade80;">${highVolume.predictedGroup || 'TIE'}</strong> (${highVolume.confidence || 0}% confidence)<br>
                📉 LOW-VOLUME: <strong style="color:#fbbf24;">${lowVolume.predictedGroup || 'TIE'}</strong> (${lowVolume.confidence || 0}% confidence)<br><br>
                💡 <em>${median.message || `Predicting ${median.predictedGroup} based on unique median frequency.`}</em>
                ${retryText}
            `;
        }
        
        if (finalWeights && stats) {
            finalWeights.innerHTML = `
                <div class="median-stats-panel">
                    <div class="median-title">📐 Triple Predictor Analysis</div>
                    <div class="median-bars">
                        <div class="median-bar low-bar" style="width: ${stats.LOW.percentage}%">LOW ${stats.LOW.percentage}%</div>
                        <div class="median-bar medium-bar" style="width: ${stats.MEDIUM.percentage}%">MED ${stats.MEDIUM.percentage}%</div>
                        <div class="median-bar high-bar" style="width: ${stats.HIGH.percentage}%">HIGH ${stats.HIGH.percentage}%</div>
                    </div>
                </div>
            `;
        }
        
        // Update triple display
        this.updateTripleDisplay();
    }
    
    showWaitingState() {
        const predictionStatusEl = document.getElementById('predictionStatus');
        const activeModelDisplay = document.getElementById('activeModelDisplay');
        const finalName = document.getElementById('finalName');
        const finalConfidence = document.getElementById('finalConfidence');
        const confidenceFill = document.getElementById('confidenceFill');
        const finalExplanation = document.getElementById('finalExplanation');
        const finalWeights = document.getElementById('finalWeights');
        
        const waitingReason = this.currentPrediction?.waitingReason || 'UNIQUE_MEDIAN_NOT_FOUND';
        const stats = this.currentPrediction?.stats;
        
        if (predictionStatusEl) predictionStatusEl.innerHTML = '<span class="status-wait">⏳ WAITING MODE</span>';
        if (activeModelDisplay) activeModelDisplay.innerHTML = '<span class="status-wait">WAITING</span>';
        if (finalName) finalName.textContent = 'WAITING';
        if (finalConfidence) finalConfidence.textContent = '0%';
        if (confidenceFill) confidenceFill.style.width = '0%';
        
        let waitingMessage = '';
        if (waitingReason === 'ALL_GROUPS_EQUAL') {
            waitingMessage = '⚖️ All three groups have EQUAL frequency. Waiting for next result to break the tie.';
        } else if (waitingReason === 'DUPLICATE_MEDIAN') {
            waitingMessage = '🔄 Median value appears in MULTIPLE groups. Waiting for unique median condition.';
        } else if (waitingReason === 'INSUFFICIENT_DATA') {
            const needed = 10 - (this.last10Groups?.length || 0);
            waitingMessage = `⏳ Need ${needed} more results to start prediction (requires 10 results).`;
        } else {
            waitingMessage = '⏳ No unique median found. Waiting for next result...';
        }
        
        if (stats && finalExplanation) {
            finalExplanation.innerHTML = `
                <strong>⏳ WAITING MODE (all predictors waiting)</strong><br><br>
                📊 <strong>Last 10 Frequencies:</strong><br>
                🔴 LOW: ${stats.LOW.count} times (${stats.LOW.percentage}%) ${stats.LOW.trend.emoji}<br>
                🟡 MEDIUM: ${stats.MEDIUM.count} times (${stats.MEDIUM.percentage}%) ${stats.MEDIUM.trend.emoji}<br>
                🟢 HIGH: ${stats.HIGH.count} times (${stats.HIGH.percentage}%) ${stats.HIGH.trend.emoji}<br><br>
                ⚠️ <strong>Reason:</strong> ${waitingMessage}<br><br>
                💡 <em>All three predictors (MEDIAN, HIGH-VOLUME, LOW-VOLUME) will make predictions when median becomes UNIQUE.</em>
            `;
        } else if (finalExplanation) {
            finalExplanation.innerHTML = `
                <strong>⏳ WAITING MODE</strong><br><br>
                ${waitingMessage}<br><br>
                📊 Need 10 results for analysis. Currently have ${this.last10Groups?.length || 0}/10 results.
            `;
        }
        
        if (finalWeights && stats) {
            finalWeights.innerHTML = `
                <div class="median-stats-panel">
                    <div class="median-title">📐 Current Frequencies</div>
                    <div class="median-bars">
                        <div class="median-bar low-bar" style="width: ${stats.LOW.percentage}%">LOW ${stats.LOW.percentage}%</div>
                        <div class="median-bar medium-bar" style="width: ${stats.MEDIUM.percentage}%">MED ${stats.MEDIUM.percentage}%</div>
                        <div class="median-bar high-bar" style="width: ${stats.HIGH.percentage}%">HIGH ${stats.HIGH.percentage}%</div>
                    </div>
                </div>
            `;
        }
        
        this.updateTripleDisplay();
    }
    
    getGroupIcon(group) {
        if (group === 'LOW') return '🔴';
        if (group === 'MEDIUM') return '🟡';
        if (group === 'HIGH') return '🟢';
        return '⚪';
    }
    
    getGroupRange(group) {
        if (group === 'LOW') return '3-9';
        if (group === 'MEDIUM') return '10-11';
        if (group === 'HIGH') return '12-18';
        return '-';
    }
    
    getGroup(number) {
        const num = parseInt(number);
        if (num >= 3 && num <= 9) return 'LOW';
        if (num >= 10 && num <= 11) return 'MEDIUM';
        if (num >= 12 && num <= 18) return 'HIGH';
        return 'UNKNOWN';
    }
    
    updateStatsDisplay(stats) {
        if (!stats) return;
        
        const totalRoundsEl = document.getElementById('totalRounds');
        const avgResultEl = document.getElementById('avgResult');
        const mostActiveGroupEl = document.getElementById('mostActiveGroup');
        const lightningBoostEl = document.getElementById('lightningBoost');
        
        if (totalRoundsEl) totalRoundsEl.textContent = (stats.totalRounds || 0).toLocaleString();
        if (avgResultEl) avgResultEl.textContent = stats.avgResult || '0.00';
        if (mostActiveGroupEl) mostActiveGroupEl.textContent = stats.mostActiveGroup || 'LOW';
        if (lightningBoostEl) lightningBoostEl.textContent = `${stats.lightningBoost || 0}%`;
    }
    
    renderHistoryTable() {
        const tbody = document.getElementById('historyTableBody');
        if (!tbody) return;
        
        if (!this.predictionHistory || this.predictionHistory.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No predictions yet. Waiting for unique median condition...</td></tr>';
            this.updatePaginationControls();
            return;
        }
        
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const pageItems = this.predictionHistory.slice(startIndex, startIndex + this.itemsPerPage);
        
        if (pageItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No history data on this page...</td></tr>';
            this.updatePaginationControls();
            return;
        }
        
        tbody.innerHTML = pageItems.map(item => {
            const getIcon = (g) => {
                if (g === 'LOW') return '🔴';
                if (g === 'MEDIUM') return '🟡';
                if (g === 'HIGH') return '🟢';
                return '⚪';
            };
            
            const getPredictionCell = (predictedGroup, isCorrect) => {
                if (!predictedGroup || predictedGroup === 'WAITING' || predictedGroup === '--') {
                    return `<span class="prediction-cell pending">⏳ --</span>`;
                }
                const icon = getIcon(predictedGroup);
                const correctClass = isCorrect === true ? 'correct' : (isCorrect === false ? 'incorrect' : 'pending');
                const checkIcon = isCorrect === true ? '✓' : (isCorrect === false ? '✗' : '⏳');
                return `<span class="prediction-cell ${correctClass}">${icon} ${predictedGroup} ${checkIcon}</span>`;
            };
            
            // Shared retry text for all columns
            const retryText = '';
            
            // Fix: Actual group display - properly show actual result
            let actualDisplay = '';
            if (item.actualGroup && item.actualGroup !== '?' && item.actualGroup !== null && item.actualGroup !== '--') {
                actualDisplay = `${getIcon(item.actualGroup)} ${item.actualGroup}`;
            } else {
                actualDisplay = `⏳ Pending`;
            }
            
            // Median info display
            const medianInfo = item.medianValue ? `<div class="small-info">📐 ${item.medianValue}</div>` : '';
            
            return `
                <tr>
                    <td style="font-size: 11px;">${item.time || '--'}</td>
                    <td class="dice-values" style="font-size: 11px;">🎲 ${item.dice || '--'}</td>
                    <td><strong>${item.total || '--'}</strong><br><small>${actualDisplay}</small></td>
                    <td>${getPredictionCell(item.predictedGroup, item.isCorrect)}${retryText}${medianInfo}</td>
                    <td>${getPredictionCell(item.predictedHighVol, item.isHighVolCorrect)}${retryText}</td>
                    <td>${getPredictionCell(item.predictedLowVol, item.isLowVolCorrect)}${retryText}</td>
                </tr>
            `;
        }).join('');
        
        this.updatePaginationControls();
    }
    
    updatePaginationControls() {
        const totalPages = Math.max(1, Math.ceil(this.predictionHistory.length / this.itemsPerPage));
        const paginationInfo = document.getElementById('paginationInfo');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        
        if (paginationInfo) paginationInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
        if (prevBtn) prevBtn.disabled = this.currentPage === 1;
        if (nextBtn) nextBtn.disabled = this.currentPage === totalPages;
    }
    
    updateRecentResultsDisplay() {
        const resultsGrid = document.getElementById('resultsGrid');
        if (!resultsGrid) return;
        
        if (!this.allResults || this.allResults.length === 0) {
            resultsGrid.innerHTML = '<div class="loading">No results yet. Waiting for data...</div>';
            return;
        }
        
        const recentResults = this.allResults.slice(0, 15);
        resultsGrid.innerHTML = recentResults.map(result => {
            const isLightning = result.multiplier > 10;
            const time = result.timestamp ? new Date(result.timestamp).toLocaleTimeString() : '--';
            const groupIcon = this.groups[result.group]?.icon || '🎲';
            
            return `
                <div class="result-card ${isLightning ? 'lightning' : ''}">
                    <div class="result-number">${groupIcon} ${result.total}</div>
                    <div class="result-multiplier">${result.multiplier || 1}x</div>
                    <div class="result-time">${time}</div>
                    <div class="result-dice">${result.diceValues || '--'}</div>
                </div>
            `;
        }).join('');
    }
    
    updateStatisticsTable() {
        const tbody = document.getElementById('statsTableBody');
        if (!tbody) return;
        
        if (!this.allResults || this.allResults.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">No data available yet...</td></tr>';
            return;
        }
        
        const numberStats = {};
        this.allResults.forEach(result => {
            if (!numberStats[result.total]) {
                numberStats[result.total] = { count: 0, lastSeen: result.timestamp };
            }
            numberStats[result.total].count++;
            if (result.timestamp > numberStats[result.total].lastSeen) {
                numberStats[result.total].lastSeen = result.timestamp;
            }
        });
        
        const sortedNumbers = Object.keys(numberStats).sort((a,b) => parseInt(a) - parseInt(b));
        const total = this.allResults.length;
        
        tbody.innerHTML = sortedNumbers.map(num => {
            const stat = numberStats[num];
            const numInt = parseInt(num);
            let group = this.getGroup(numInt);
            const groupClass = `group-${group.toLowerCase()}`;
            const percentage = total > 0 ? ((stat.count / total) * 100).toFixed(1) : 0;
            const timeAgo = this.getTimeAgo(stat.lastSeen);
            
            return `
                <tr>
                    <td><strong>${num}</strong></td>
                    <td><span class="group-badge ${groupClass}">${group}</span></td>
                    <td>${stat.count}</td>
                    <td>${percentage}%</td>
                    <td>${timeAgo}</td>
                </tr>
            `;
        }).join('');
    }
    
    getTimeAgo(date) {
        if (!date) return 'Unknown';
        const diffMins = Math.floor((new Date() - new Date(date)) / 60000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
        return `${Math.floor(diffMins / 1440)}d ago`;
    }
    
    updateConnectionStatus(isConnected) {
        const statusText = document.getElementById('statusText');
        const statusDot = document.querySelector('.status-dot');
        if (statusText) statusText.textContent = isConnected ? 'Live' : 'Reconnecting...';
        if (statusDot) statusDot.style.background = isConnected ? '#4ade80' : '#ef4444';
    }
    
    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        let reconnectDelay = 1000;
        const maxDelay = 30000;
        
        const connect = () => {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('🔌 WebSocket connected - listening for real-time updates');
                reconnectDelay = 1000;
                this.updateConnectionStatus(true);
            };
            
            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === 'new_result') {
                    console.log('🆕 Real-time update received via WebSocket');
                    this.handleRealtimeUpdate(data);
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus(false);
            };
            
            this.ws.onclose = () => {
                console.log(`WebSocket disconnected, reconnecting in ${reconnectDelay}ms...`);
                this.updateConnectionStatus(false);
                setTimeout(connect, reconnectDelay);
                reconnectDelay = Math.min(reconnectDelay * 1.5, maxDelay);
            };
        };
        
        connect();
    }
    
    handleRealtimeUpdate(data) {
        console.log('📨 Processing realtime update');
        
        // Update allResults
        if (data.allResults) {
            this.allResults = data.allResults.sort((a, b) => {
                return new Date(b.timestamp) - new Date(a.timestamp);
            });
            this.updateRecentResultsDisplay();
            this.updateStatisticsTable();
        }
        
        // Add new result
        if (data.result) {
            const exists = this.allResults.some(r => r.id === data.result.id);
            if (!exists) {
                this.allResults.unshift(data.result);
                this.allResults.sort((a, b) => {
                    return new Date(b.timestamp) - new Date(a.timestamp);
                });
                if (this.allResults.length > 100) this.allResults.pop();
                
                this.updateRecentResultsDisplay();
                this.updateStatisticsTable();
            }
        }
        
        // Update last10 groups
        if (data.last10Groups) {
            this.last10Groups = data.last10Groups;
            this.updateLast10Display();
            this.updateGroupProbabilities();
        }
        
        // Update prediction history (only valid predictions)
        if (data.history) {
            this.predictionHistory = data.history;
            this.renderHistoryTable();
        }
        
        // Update current prediction
        if (data.prediction) {
            this.currentPrediction = data.prediction;
            this.displayPrediction(data.prediction);
            this.updateGroupProbabilities();
            this.updateTripleDisplay();
        }
        
        // Update stats
        if (data.stats) this.updateStatsDisplay(data.stats);
        
        this.animateNewResult();
    }
    
    setupCollapsibleStats() {
        const statsHeader = document.getElementById('statsHeader');
        const statsContent = document.getElementById('statsContent');
        const toggleIcon = document.getElementById('toggleIcon');
        
        if (statsHeader && statsContent && toggleIcon) {
            statsHeader.addEventListener('click', () => {
                const isVisible = statsContent.style.display !== 'none';
                statsContent.style.display = isVisible ? 'none' : 'block';
                toggleIcon.classList.toggle('open', !isVisible);
            });
        }
    }
    
    setupAutoRefresh() {
        const toggle = document.getElementById('autoRefreshToggle');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                this.autoRefreshEnabled = e.target.checked;
                if (this.autoRefreshEnabled) {
                    this.startAutoRefreshTimer();
                } else {
                    this.stopAutoRefreshTimer();
                }
            });
        }
        
        if (this.autoRefreshEnabled) {
            this.startAutoRefreshTimer();
        }
    }
    
    startAutoRefreshTimer() {
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        
        let timer = 3;
        const timerEl = document.getElementById('refreshTimer');
        
        this.autoRefreshInterval = setInterval(() => {
            if (timer <= 1) {
                if (this.autoRefreshEnabled) {
                    this.loadInitialData();
                }
                timer = 3;
            } else {
                timer--;
            }
            
            if (timerEl && this.autoRefreshEnabled) {
                timerEl.textContent = `${timer}s`;
            }
        }, 1000);
    }
    
    stopAutoRefreshTimer() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
        const timerEl = document.getElementById('refreshTimer');
        if (timerEl) timerEl.textContent = 'OFF';
    }
    
    bindEvents() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadInitialData());
        
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        if (prevBtn) prevBtn.addEventListener('click', () => this.changePage(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => this.changePage(1));
    }
    
    changePage(delta) {
        const newPage = this.currentPage + delta;
        const totalPages = Math.max(1, Math.ceil(this.predictionHistory.length / this.itemsPerPage));
        if (newPage >= 1 && newPage <= totalPages) {
            this.currentPage = newPage;
            this.renderHistoryTable();
        }
    }
    
    animateNewResult() {
        const predictionBox = document.querySelector('.prediction-section');
        if (predictionBox) {
            predictionBox.style.animation = 'none';
            setTimeout(() => predictionBox.style.animation = 'slideIn 0.3s ease', 10);
        }
    }
}

// Initialize app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.app = new LightningDiceApp();
    });
} else {
    window.app = new LightningDiceApp();
}
