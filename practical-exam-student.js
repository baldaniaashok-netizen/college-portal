// Practical Exam Student Functions

let currentSubmissionId = null;

// Initialize practical exam UI
function initializePracticalExamUI() {
  const studentDashboard = document.getElementById('student-dashboard');
  const practicalContainer = document.getElementById('practical-exam-container');
  
  if (studentDashboard && practicalContainer) {
    practicalContainer.style.display = 'block';
    loadStudentSubmissions();
    setupPracticalEventListeners();
    autoSetExamTitle();
  }
}

function autoSetExamTitle() {
  // Auto-set exam title to username
  const userEmail = localStorage.getItem('userEmail') || 'student';
  const username = userEmail.split('@')[0]; // Get username part from email
  const examTitleInput = document.getElementById('exam-title');
  if (examTitleInput) {
    examTitleInput.value = username;
    examTitleInput.disabled = true; // Prevent editing
    examTitleInput.title = 'Exam title is auto-set to your username';
  }
}

function setupPracticalEventListeners() {
  const form = document.getElementById('create-practical-exam-form');
  if (form) {
    form.addEventListener('submit', createPracticalExamSubmission);
  }
}

async function createPracticalExamSubmission(e) {
  e.preventDefault();
  
  const userEmail = localStorage.getItem('userEmail') || 'student';
  const username = userEmail.split('@')[0]; // Auto-set to username
  const description = document.getElementById('exam-description').value.trim();
  const subject = document.getElementById('exam-subject').value.trim();
  const examDate = document.getElementById('exam-due-date').value;
  const messageEl = document.getElementById('create-practical-message');
  
  const fileInput = document.getElementById('create-exam-file-input');
  const files = fileInput ? fileInput.files : [];
  
  if (!subject) {
    messageEl.innerText = 'Subject is required';
    messageEl.style.color = 'red';
    return;
  }

  try {
    messageEl.innerText = 'Creating submission...';
    messageEl.style.color = 'blue';

    const response = await fetch('/api/practical-exam/create', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify({
        examTitle: username, // Use username as exam title
        examDescription: description,
        subject: subject,
        dueDate: examDate || null
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create submission');
    }

    const submissionId = data.submissionId;
    let uploadMessage = '';

    // If files are selected, upload them now!
    if (files.length > 0) {
      messageEl.innerText = 'Uploading selected files...';
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      const uploadResponse = await fetch(`/api/practical-exam/${submissionId}/upload`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
        body: formData
      });

      const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok) {
        throw new Error(uploadData.error || 'Submission created but file upload failed');
      }
      uploadMessage = ` and ${files.length} file(s) uploaded successfully!`;
    }

    messageEl.innerText = 'Submission created' + (uploadMessage || ' successfully!');
    messageEl.style.color = 'green';
    
    // Reset form
    document.getElementById('create-practical-exam-form').reset();
    autoSetExamTitle(); // Re-set exam title after reset
    
    // Reload submissions
    setTimeout(() => {
      loadStudentSubmissions();
      messageEl.innerText = '';
    }, 1500);
  } catch (error) {
    messageEl.innerText = error.message;
    messageEl.style.color = 'red';
  }
}

async function loadStudentSubmissions() {
  try {
    const response = await fetch('/api/practical-exam/my-submissions', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });

    if (!response.ok) {
      throw new Error('Failed to load submissions');
    }

    const data = await response.json();
    const container = document.getElementById('practical-submissions-list');

    if (data.submissions.length === 0) {
      container.innerHTML = '<p style="color: #999;">No submissions yet. Create one above to get started!</p>';
      return;
    }

    let html = '<div>';
    data.submissions.forEach(submission => {
      const statusBadge = `<span class="submission-badge badge-${submission.submissionStatus}">${submission.submissionStatus.toUpperCase()}</span>`;
      const marksDisplay = submission.marks !== null ? `${submission.marks}` : '-';
      
      html += `
        <div class="submission-card" onclick="viewSubmissionDetail('${submission.id}')">
          <h4>${submission.examTitle}</h4>
          <div>
            ${statusBadge}
            <span style="margin-left: 10px; color: #666;">📁 ${submission.totalFiles} file(s)</span>
          </div>
          <p style="margin: 8px 0 0 0; font-size: 14px;">
            <strong>Subject:</strong> ${submission.subject}
            <br><strong>Marks:</strong> ${marksDisplay}
            <br><strong>Submitted:</strong> ${submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString() : 'Not submitted'}
          </p>
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (error) {
    document.getElementById('practical-submissions-list').innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
  }
}

async function viewSubmissionDetail(submissionId) {
  try {
    const response = await fetch(`/api/practical-exam/${submissionId}`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });

    if (!response.ok) {
      throw new Error('Failed to load submission details');
    }

    const data = await response.json();
    const submission = data.submission;
    
    currentSubmissionId = submissionId;
    
    // Populate modal
    document.getElementById('modal-exam-title').innerText = submission.examTitle;
    document.getElementById('modal-status').innerText = submission.submissionStatus.toUpperCase();
    document.getElementById('modal-total-files').innerText = submission.totalFiles;
    document.getElementById('modal-submitted-date').innerText = submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : 'Not submitted';
    document.getElementById('modal-due-date').innerText = submission.dueDate ? new Date(submission.dueDate).toLocaleString() : 'No deadline';
    
    // Show late submission warning
    const lateWarning = document.getElementById('late-submission-warning');
    if (submission.isLateSubmission) {
      lateWarning.style.display = 'block';
    } else {
      lateWarning.style.display = 'none';
    }
    
    // Show review section if reviewed
    const reviewSection = document.getElementById('review-section');
    if (submission.submissionStatus === 'reviewed') {
      document.getElementById('modal-marks').innerText = submission.marks !== null ? submission.marks : '-';
      document.getElementById('modal-feedback').innerText = submission.feedback || '-';
      document.getElementById('modal-reviewed-by').innerText = submission.reviewedBy || '-';
      reviewSection.style.display = 'block';
    } else {
      reviewSection.style.display = 'none';
    }
    
    // Show/hide upload section based on status
    const uploadSection = document.getElementById('upload-section');
    if (submission.submissionStatus !== 'reviewed') {
      uploadSection.style.display = 'block';
    } else {
      uploadSection.style.display = 'none';
    }
    
    // Populate files by type
    const filesByTypeSection = document.getElementById('files-by-type-section');
    let filesByTypeHtml = '';
    
    if (submission.filesByType && Object.keys(submission.filesByType).length > 0) {
      const fileTypeIcons = {
        'source_code': '📄',
        'document': '📋',
        'screenshot': '🖼️',
        'output': '📊',
        'other': '📦'
      };
      
      for (const [fileType, files] of Object.entries(submission.filesByType)) {
        const icon = fileTypeIcons[fileType] || '📁';
        filesByTypeHtml += `
          <div class="file-type-section">
            <h5>${icon} ${fileType.replace('_', ' ').toUpperCase()} (${files.length})</h5>
            <ul class="file-list">
        `;
        
        files.forEach(file => {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
          filesByTypeHtml += `
            <li class="file-item">
              <div>
                <strong>${file.originalName}</strong>
                <small>${sizeMB} MB • ${new Date(file.uploadedAt).toLocaleDateString()}</small>
              </div>
              <div>
                <button onclick="practicalDownloadFile('${submissionId}', '${file.filename}')" class="btn btn-small" style="margin-right: 8px;">⬇ Download</button>
                ${submission.submissionStatus !== 'reviewed' ? `<button onclick="deleteFile('${submissionId}', '${file.filename}')" class="btn btn-small btn-danger">🗑 Delete</button>` : ''}
              </div>
            </li>
          `;
        });
        
        filesByTypeHtml += `</ul></div>`;
      }
    } else {
      filesByTypeHtml = '<p style="color: #999;">No files uploaded yet.</p>';
    }
    
    filesByTypeSection.innerHTML = filesByTypeHtml;
    
    // Show modal
    document.getElementById('submission-detail-modal').style.display = 'block';
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

function closeSubmissionModal() {
  document.getElementById('submission-detail-modal').style.display = 'none';
  currentSubmissionId = null;
}

async function uploadPracticalFiles() {
  const fileInput = document.getElementById('practical-file-input');
  const files = fileInput.files;
  
  if (files.length === 0) {
    alert('Please select files to upload');
    return;
  }
  
  if (!currentSubmissionId) {
    alert('No submission selected');
    return;
  }

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  const progressDiv = document.getElementById('upload-progress');
  const uploadButton = document.getElementById('practical-upload-button');
  progressDiv.innerHTML = '<p>Uploading files... Please wait. Large practical files may take a few minutes.</p>';
  if (uploadButton) {
    uploadButton.disabled = true;
    uploadButton.innerText = 'Uploading...';
  }

  try {
    const response = await fetch(`/api/practical-exam/${currentSubmissionId}/upload`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
      body: formData
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    progressDiv.innerHTML = `<p style="color: green;">${data.message} (${data.uploadedCount} file(s) uploaded)</p>`;
    fileInput.value = '';
    
    setTimeout(() => {
      viewSubmissionDetail(currentSubmissionId);
    }, 1000);
  } catch (error) {
    progressDiv.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
  } finally {
    if (uploadButton) {
      uploadButton.disabled = false;
      uploadButton.innerText = 'Upload Files';
    }
  }
}

async function practicalDownloadFile(submissionId, filename) {
  try {
    const response = await fetch(`/api/practical-exam/${submissionId}/download/${filename}`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });

    if (!response.ok) {
      throw new Error('Download failed');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('-').slice(1).join('-') || filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    alert('Error downloading file: ' + error.message);
  }
}

async function deleteFile(submissionId, filename) {
  if (!confirm('Are you sure you want to delete this file?')) {
    return;
  }

  try {
    const response = await fetch(`/api/practical-exam/${submissionId}/file/${filename}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Delete failed');
    }

    alert('File deleted successfully');
    viewSubmissionDetail(submissionId);
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const userRole = localStorage.getItem('userRole');
  if (userRole === 'student') {
    // Try to find and initialize practical exam UI
    if (document.getElementById('practical-exam-container')) {
      initializePracticalExamUI();
    }
  }
});




