// Practical Exam Admin Functions

let currentAdminSubmissionId = null;

// Initialize admin practical exam UI
function initializeAdminPracticalExamUI() {
  const adminDashboard = document.getElementById('admin-dashboard');
  const adminContainer = document.getElementById('admin-practical-exam-container');
  
  if (adminDashboard && adminContainer) {
    adminContainer.style.display = 'block';
    filterAndLoadSubmissions();
    setupAdminEventListeners();
  }
}

function setupAdminEventListeners() {
  // Add Enter key listener to filter fields
  const filterFields = ['filter-exam-title', 'filter-course', 'filter-semester', 'filter-status'];
  filterFields.forEach(fieldId => {
    const element = document.getElementById(fieldId);
    if (element) {
      element.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          filterAndLoadSubmissions();
        }
      });
    }
  });
}

async function filterAndLoadSubmissions() {
  const examTitle = document.getElementById('filter-exam-title').value.trim();
  const course = document.getElementById('filter-course').value;
  const semester = document.getElementById('filter-semester').value;
  const status = document.getElementById('filter-status').value;
  const submissionDateFrom = document.getElementById('filter-submission-date').value;
  const submissionDateTo = document.getElementById('filter-submission-date-to').value;

  const params = new URLSearchParams();
  if (examTitle) params.append('examTitle', examTitle);
  if (course) params.append('course', course);
  if (semester) params.append('semester', semester);
  if (status) params.append('submissionStatus', status);
  if (submissionDateFrom) params.append('submissionDateFrom', submissionDateFrom);
  if (submissionDateTo) params.append('submissionDateTo', submissionDateTo);

  try {
    const response = await fetch(`/api/practical-exam/admin/submissions?${params.toString()}`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });

    if (!response.ok) {
      throw new Error('Failed to load submissions');
    }

    const data = await response.json();
    displaySubmissionsTable(data.submissions);
  } catch (error) {
    document.getElementById('submissions-tbody').innerHTML = `<tr><td colspan="9" style="text-align: center; color: red; padding: 20px;">Error: ${error.message}</td></tr>`;
  }
}

function displaySubmissionsTable(submissions) {
  const tbody = document.getElementById('submissions-tbody');
  
  if (submissions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: #999;">No submissions found</td></tr>';
    return;
  }

  let html = '';
  submissions.forEach(submission => {
    const statusBadge = `<span class="status-badge status-${submission.submissionStatus}">${submission.submissionStatus.toUpperCase()}</span>`;
    const marksDisplay = submission.marks !== null ? submission.marks : '-';
    const submittedDate = submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString() : 'Not submitted';

    html += `
      <tr>
        <td><strong>${submission.studentName}</strong><br><small style="color: #666;">${submission.studentEmail}</small></td>
        <td>${submission.examTitle}</td>
        <td>${submission.course}</td>
        <td style="text-align: center;">${submission.semester}</td>
        <td style="text-align: center;">📁 ${submission.totalFiles}</td>
        <td style="text-align: center;">${statusBadge}</td>
        <td style="text-align: center;">${marksDisplay}</td>
        <td>${submittedDate}</td>
        <td style="text-align: center;">
          <button onclick="viewAdminSubmissionDetail('${submission.id}')" class="btn btn-small" style="padding: 4px 8px;">👁 View</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

async function viewAdminSubmissionDetail(submissionId) {
  try {
    const response = await fetch(`/api/practical-exam/${submissionId}`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });

    if (!response.ok) {
      throw new Error('Failed to load submission details');
    }

    const data = await response.json();
    const submission = data.submission;
    
    currentAdminSubmissionId = submissionId;
    
    // Populate modal with submission info
    document.getElementById('admin-modal-exam-title').innerText = submission.examTitle;
    document.getElementById('admin-modal-student-name').innerText = submission.studentName;
    document.getElementById('admin-modal-student-email').innerText = submission.studentEmail;
    document.getElementById('admin-modal-course').innerText = submission.course;
    document.getElementById('admin-modal-semester').innerText = submission.semester;
    document.getElementById('admin-modal-subject').innerText = submission.subject;
    document.getElementById('admin-modal-status').innerText = submission.submissionStatus.toUpperCase();
    document.getElementById('admin-modal-total-files').innerText = submission.totalFiles;
    document.getElementById('admin-modal-submitted-at').innerText = submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : 'Not submitted';
    
    // Show late submission warning
    const lateMarker = document.getElementById('admin-modal-late-marker');
    if (submission.isLateSubmission) {
      lateMarker.style.display = 'block';
    } else {
      lateMarker.style.display = 'none';
    }
    
    // Load existing review data
    if (submission.submissionStatus === 'reviewed') {
      document.getElementById('admin-review-marks').value = submission.marks || '';
      document.getElementById('admin-review-feedback').value = submission.feedback || '';
    } else {
      document.getElementById('admin-review-marks').value = '';
      document.getElementById('admin-review-feedback').value = '';
    }
    
    // Populate files by type
    const filesByTypeDiv = document.getElementById('admin-files-by-type');
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
          <div class="admin-file-type-section">
            <h5>${icon} ${fileType.replace('_', ' ').toUpperCase()} (${files.length} file${files.length !== 1 ? 's' : ''})</h5>
            <ul class="admin-file-list">
        `;
        
        files.forEach(file => {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
          filesByTypeHtml += `
            <li class="admin-file-item">
              <div>
                <strong>${file.originalName}</strong>
                <br><small style="color: #666;">${sizeMB} MB • ${new Date(file.uploadedAt).toLocaleDateString()}</small>
              </div>
              <button onclick="adminDownloadFile('${submissionId}', '${file.filename}')" class="btn btn-small" style="padding: 4px 8px;">⬇ Download</button>
            </li>
          `;
        });
        
        filesByTypeHtml += `</ul></div>`;
      }
    } else {
      filesByTypeHtml = '<p style="color: #999;">No files uploaded.</p>';
    }
    
    filesByTypeDiv.innerHTML = filesByTypeHtml;
    
    // Show modal
    document.getElementById('admin-submission-modal').style.display = 'block';
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

function closeAdminSubmissionModal() {
  document.getElementById('admin-submission-modal').style.display = 'none';
  currentAdminSubmissionId = null;
}

async function submitReview() {
  if (!currentAdminSubmissionId) {
    alert('No submission selected');
    return;
  }

  const marks = document.getElementById('admin-review-marks').value;
  const feedback = document.getElementById('admin-review-feedback').value;
  const messageDiv = document.getElementById('review-message');

  if (!marks && !feedback) {
    messageDiv.innerHTML = '<p style="color: red;">Please enter marks or feedback</p>';
    return;
  }

  try {
    const response = await fetch(`/api/practical-exam/${currentAdminSubmissionId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify({
        marks: marks ? parseInt(marks) : null,
        feedback: feedback
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to submit review');
    }

    messageDiv.innerHTML = '<p style="color: green;">✓ Review submitted successfully</p>';
    
    setTimeout(() => {
      closeAdminSubmissionModal();
      filterAndLoadSubmissions();
    }, 1500);
  } catch (error) {
    messageDiv.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
  }
}

async function adminDownloadFile(submissionId, filename) {
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

async function downloadAllSubmissions() {
  const examTitle = document.getElementById('filter-exam-title').value.trim();
  const course = document.getElementById('filter-course').value;
  const semester = document.getElementById('filter-semester').value;

  if (!examTitle) {
    alert('Please enter an Exam Title to download submissions');
    return;
  }

  if (!confirm(`Download all submissions for "${examTitle}"? This will create a ZIP file.`)) {
    return;
  }

  try {
    const response = await fetch('/api/practical-exam/admin/download-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify({
        examTitle: examTitle,
        course: course || undefined,
        semester: semester ? parseInt(semester) : undefined
      })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Download failed');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${examTitle}-submissions-${new Date().getTime()}.zip`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const userRole = localStorage.getItem('userRole');
  if (userRole === 'admin' || userRole === 'master_admin') {
    // Try to find and initialize admin practical exam UI
    if (document.getElementById('admin-practical-exam-container')) {
      initializeAdminPracticalExamUI();
    }
  }
});
