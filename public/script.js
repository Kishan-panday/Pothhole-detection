// DOM Elements
const uploadBox = document.getElementById('uploadBox');
const imageInput = document.getElementById('imageInput');
const uploadSection = document.getElementById('upload-section');
const resultsSection = document.getElementById('resultsSection');
const historySection = document.getElementById('historySection');
const loadingSpinner = document.getElementById('loadingSpinner');
const predictionModal = document.getElementById('predictionModal');
const modalClose = document.querySelector('.close');

const API_BASE_URL = 'http://127.0.0.1:5500';

// Class information
const CLASS_INFO = {
    good: {
        label: 'Good',
        description: 'Excellent road condition - No maintenance needed',
        emoji: '✅',
        color: '#28a745',
        recommendations: [
            'Continue regular maintenance schedule',
            'Monitor for any new surface distress',
            'Update road condition database'
        ]
    },
    satisfactory: {
        label: 'Satisfactory',
        description: 'Adequate condition - Minor maintenance recommended',
        emoji: '⚠️',
        color: '#ffc107',
        recommendations: [
            'Schedule preventive maintenance',
            'Fill minor cracks and potholes',
            'Plan for maintenance budget allocation'
        ]
    },
    poor: {
        label: 'Poor',
        description: 'Poor condition - Maintenance required soon',
        emoji: '⚠️',
        color: '#fd7e14',
        recommendations: [
            'Prioritize repairs in 3-6 months',
            'Repair potholes and major cracks',
            'Consider road resurfacing'
        ]
    },
    very_poor: {
        label: 'Very Poor',
        description: 'Critical condition - Urgent repairs needed',
        emoji: '🚨',
        color: '#dc3545',
        recommendations: [
            'Schedule emergency repairs',
            'Issue road safety warnings',
            'Plan complete resurfacing project'
        ]
    }
};

function getSafeClassInfo(predictedClass, backendClassInfo = {}) {
    const fallback = CLASS_INFO[predictedClass] || {
        label: predictedClass || 'Unknown',
        description: 'Road condition result',
        emoji: 'ℹ️',
        color: '#6c757d',
        recommendations: ['Review this image manually for confirmation.']
    };

    return {
        ...fallback,
        ...backendClassInfo,
        recommendations: Array.isArray(backendClassInfo?.recommendations)
            ? backendClassInfo.recommendations
            : fallback.recommendations
    };
}

// Event Listeners
uploadBox.addEventListener('click', () => imageInput.click());
uploadBox.addEventListener('dragover', handleDragOver);
uploadBox.addEventListener('dragleave', handleDragLeave);
uploadBox.addEventListener('drop', handleDrop);
imageInput.addEventListener('change', handleImageSelect);
modalClose.addEventListener('click', () => predictionModal.style.display = 'none');
window.addEventListener('click', (e) => {
    if (e.target === predictionModal) predictionModal.style.display = 'none';
});

// File Upload Handlers
function handleDragOver(e) {
    e.preventDefault();
    uploadBox.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        imageInput.files = files;
        handleImageSelect();
    }
}

function handleImageSelect() {
    const file = imageInput.files[0];
    if (file) {
        uploadImage(file);
    }
}

// Upload and Predict
async function uploadImage(file) {
    loadingSpinner.style.display = 'block';
    const spinnerText = loadingSpinner.querySelector('p');
    spinnerText.textContent = '⏳ Analyzing image... (This may take 60+ seconds on first run)';
    
    console.log('📤 Uploading image:', file.name);
    
    try {
        const userId = document.getElementById('userId').value || 'anonymous';
        const location = document.getElementById('location').value || 'Unknown';
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('userId', userId);
        formData.append('location', location);

        console.log('🔄 Sending to server...');
        
        // Create abort controller with 5 minute timeout (300 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000);

        const response = await fetch(`${API_BASE_URL}/api/predict`, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log('📩 Response received:', response.status);

        const result = await response.json().catch(() => ({ success: false, error: 'Invalid JSON response' }));

        if (!response.ok || !result.success) {
            const message = result.error || response.statusText || 'Prediction failed';
            throw new Error(`Server error: ${message}`);
        }
        
        console.log('✅ Prediction result:', result);

        displayResults(result.data);
        loadingSpinner.style.display = 'none';
        resultsSection.style.display = 'block';
        resultsSection.scrollIntoView({ behavior: 'smooth' });
        loadPredictionHistory();
    } catch (error) {
        loadingSpinner.style.display = 'none';
        console.error('❌ Error:', error);
        if (error.name === 'AbortError') {
            alert('❌ REQUEST TIMEOUT\n\nPossible issues:\n1. ❌ MongoDB is NOT running\n2. ⏳ Model is loading (first time takes ~60 seconds)\n3. ❌ TensorFlow/Python not installed\n\nCheck:\n- Is MongoDB running? (mongod in terminal)\n- Open F12 Console to see server errors');
        } else {
            alert('❌ Error: ' + error.message + '\n\n👉 Press F12 and check the Console tab for more details');
        }
    }
}

// Display Results
function displayResults(data) {
    const { predictedClass, confidence, allPredictions, classInfo, image } = data;
    const safeClassInfo = getSafeClassInfo(predictedClass, classInfo);

    // Display image
    document.getElementById('previewImage').src = image;

    // Display prediction result
    const predictionHTML = `
        <div class="prediction-class">${safeClassInfo.emoji}</div>
        <div class="prediction-label">${safeClassInfo.label}</div>
        <div class="prediction-status status-${safeClassInfo.status || 'adequate'}">
            ${safeClassInfo.description}
        </div>
        <div class="confidence-score">
            Confidence: <span style="color: ${safeClassInfo.color};">${confidence.toFixed(2)}%</span>
        </div>
    `;
    document.getElementById('predictionResult').innerHTML = predictionHTML;

    // Display breakdown
    let breakdownHTML = '';
    for (const [className, percentage] of Object.entries(allPredictions || {})) {
        const info = CLASS_INFO[className] || {
            label: className,
            color: '#6c757d'
        };
        breakdownHTML += `
            <div class="breakdown-item">
                <div class="breakdown-class">${info.label}</div>
                <div class="breakdown-percentage">${percentage.toFixed(1)}%</div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${percentage}%; background-color: ${info.color};"></div>
                </div>
            </div>
        `;
    }
    document.getElementById('breakdownChart').innerHTML = breakdownHTML;

    // Display recommendations
    let recommendationsHTML = '';
    safeClassInfo.recommendations.forEach(rec => {
        recommendationsHTML += `
            <div class="recommendation-item">
                <strong>→</strong> ${rec}
            </div>
        `;
    });
    document.getElementById('recommendations').innerHTML = recommendationsHTML;
}

// Reset Form
function resetForm() {
    imageInput.value = '';
    resultsSection.style.display = 'none';
    document.getElementById('userId').value = '';
    document.getElementById('location').value = '';
    uploadSection.scrollIntoView({ behavior: 'smooth' });
}

// Load Prediction History
async function loadPredictionHistory() {
    try {
        const userId = document.getElementById('userId').value || '';
        const queryString = userId ? `?userId=${encodeURIComponent(userId)}` : '';
        
        const response = await fetch(`${API_BASE_URL}/api/predictions${queryString}`);
        const result = await response.json();

        if (response.status === 503) {
            document.getElementById('historyContainer').innerHTML = '<p class="empty-state">History unavailable: MongoDB is not connected.</p>';
            const statsContainer = document.getElementById('statsContainer');
            statsContainer.style.display = 'none';
            return;
        }

        if (result.success) {
            const predictions = result.data;
            let historyHTML = '';

            if (predictions.length === 0) {
                historyHTML = '<p class="empty-state">No predictions yet</p>';
            } else {
                predictions.forEach(pred => {
                    const date = new Date(pred.timestamp).toLocaleDateString();
                    const time = new Date(pred.timestamp).toLocaleTimeString();
                    const classInfo = CLASS_INFO[pred.predictedClass];
                    
                    historyHTML += `
                        <div class="history-item" onclick="viewPredictionDetail('${pred._id}')">
                            <div class="history-thumbnail" style="background: linear-gradient(135deg, ${classInfo.color}, rgba(0,0,0,0.1));">
                                <div style="font-size: 2.5rem; display: flex; align-items: center; justify-content: center; height: 100%;">
                                    ${classInfo.emoji}
                                </div>
                            </div>
                            <div class="history-details">
                                <h4>${classInfo.label} - ${pred.confidence.toFixed(1)}%</h4>
                                <p><strong>Location:</strong> ${pred.location}</p>
                                <p><strong>Date:</strong> ${date} ${time}</p>
                                <p><strong>User:</strong> ${pred.userId}</p>
                            </div>
                            <button class="history-delete" onclick="deletePrediction('${pred._id}', event)">Delete</button>
                        </div>
                    `;
                });
            }

            document.getElementById('historyContainer').innerHTML = historyHTML;
            
            // Load and display stats
            loadStats(userId);
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

// Load Statistics
async function loadStats(userId = '') {
    try {
        const queryString = userId ? `?userId=${encodeURIComponent(userId)}` : '';
        const response = await fetch(`${API_BASE_URL}/api/stats${queryString}`);
        const result = await response.json();

        if (response.status === 503) {
            const statsContainer = document.getElementById('statsContainer');
            statsContainer.style.display = 'none';
            return;
        }

        if (result.success) {
            const { totalPredictions, classDistribution, averageConfidence } = result.data;
            
            let statsHTML = `
                <div class="stat-item">
                    <div class="stat-value">${totalPredictions}</div>
                    <div class="stat-label">Total Predictions</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${averageConfidence}%</div>
                    <div class="stat-label">Avg Confidence</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${classDistribution.good}</div>
                    <div class="stat-label">Good Roads</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${classDistribution.satisfactory}</div>
                    <div class="stat-label">Satisfactory</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${classDistribution.poor}</div>
                    <div class="stat-label">Poor Roads</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${classDistribution.very_poor}</div>
                    <div class="stat-label">Very Poor</div>
                </div>
            `;
            
            const statsContainer = document.getElementById('statsContainer');
            statsContainer.innerHTML = statsHTML;
            statsContainer.style.display = 'grid';
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// View Prediction Detail
async function viewPredictionDetail(predictionId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/predictions/${predictionId}`);
        const result = await response.json();

        if (response.status === 503) {
            alert('History detail is unavailable because MongoDB is not connected.');
            return;
        }

        if (result.success) {
            const pred = result.data;
            const classInfo = getSafeClassInfo(pred.predictedClass, {});
            const date = new Date(pred.timestamp).toLocaleString();
            
            const modalHTML = `
                <img src="data:image/jpeg;base64,${pred.imageBase64}" style="width: 100%; border-radius: 8px; margin-bottom: 1rem;">
                <div style="background: linear-gradient(135deg, ${classInfo.color}, rgba(0,0,0,0.1)); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                    <h3 style="margin-bottom: 0.5rem;">${classInfo.emoji} ${classInfo.label}</h3>
                    <p>Confidence: <strong>${pred.confidence.toFixed(2)}%</strong></p>
                </div>
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <p><strong>Location:</strong> ${pred.location}</p>
                    <p><strong>User:</strong> ${pred.userId}</p>
                    <p><strong>Date:</strong> ${date}</p>
                    <p><strong>File:</strong> ${pred.filename}</p>
                </div>
            `;
            
            document.getElementById('modalBody').innerHTML = modalHTML;
            predictionModal.style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading prediction detail:', error);
    }
}

// Delete Prediction
async function deletePrediction(predictionId, event) {
    event.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this prediction?')) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/predictions/${predictionId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (response.status === 503) {
            alert('Delete is unavailable because MongoDB is not connected.');
            return;
        }

        if (result.success) {
            alert('Prediction deleted successfully');
            loadPredictionHistory();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error deleting prediction:', error);
        alert('Error: ' + error.message);
    }
}

// Toggle History View
function toggleHistoryView() {
    historySection.style.display = historySection.style.display === 'none' ? 'block' : 'none';
    if (historySection.style.display === 'block') {
        loadPredictionHistory();
        historySection.scrollIntoView({ behavior: 'smooth' });
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('App initialized');
    loadPredictionHistory();
});