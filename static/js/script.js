// Prevent page refresh on button clicks
document.addEventListener('DOMContentLoaded', function() {
    // Prevent all form submissions
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
        });
    });
});
// Global variables
let semesterCount = 1
let currentTab = "cgpa"

// Initialize the application with minimal functionality
document.addEventListener("DOMContentLoaded", () => {
  console.log("Page loaded successfully")

  // Only initialize essential functions
  try {
    initializeTabs()
    console.log("Tabs initialized")
  } catch (error) {
    console.error("Error initializing tabs:", error)
  }

  // Auto-hide flash messages safely
  try {
    setTimeout(() => {
      const flashMessages = document.getElementById("flashMessages")
      if (flashMessages) {
        flashMessages.style.display = "none"
      }
    }, 5000)
  } catch (error) {
    console.error("Error hiding flash messages:", error)
  }
})

// Tab functionality - simplified and safe
function initializeTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn")
  const tabPanes = document.querySelectorAll(".tab-pane")

  if (!tabButtons.length || !tabPanes.length) {
    console.log("Tab elements not found")
    return
  }

  tabButtons.forEach((button) => {
    button.addEventListener("click", (e) => {
      e.preventDefault()

      try {
        const tabId = button.getAttribute("data-tab")
        console.log("Switching to tab:", tabId)

        // Remove active class from all tabs and panes
        tabButtons.forEach((btn) => btn.classList.remove("active"))
        tabPanes.forEach((pane) => pane.classList.remove("active"))

        // Add active class to clicked tab and corresponding pane
        button.classList.add("active")
        const targetPane = document.getElementById(tabId)
        if (targetPane) {
          targetPane.classList.add("active")
        }

        currentTab = tabId

        // Only load data when specifically requested and safely
        if (tabId === "holidays") {
          setTimeout(() => loadHolidays(), 100)
        } else if (tabId === "history") {
          setTimeout(() => loadHistory(), 100)
        }
      } catch (error) {
        console.error("Error switching tabs:", error)
      }
    })
  })
}

// CGPA Calculator Functions - simplified
function addSemester() {
  try {
    semesterCount++
    const container = document.getElementById("semesterContainer")

    if (!container) {
      console.error("Semester container not found")
      return
    }

    const semesterHTML = `
      <div class="semester-item" data-semester="${semesterCount}">
          <div class="semester-header">
              <span class="semester-title">Semester ${semesterCount}</span>
              <button class="remove-semester" onclick="removeSemester(${semesterCount})" type="button">
                  <i class="fas fa-trash"></i>
              </button>
          </div>
          <div class="semester-inputs">
              <div class="input-group">
                  <label>SGPA</label>
                  <input type="number" step="0.01" min="0" max="10" placeholder="e.g., 8.37" class="sgpa-input">
              </div>
              <div class="input-group">
                  <label>Credits</label>
                  <input type="number" min="0" placeholder="e.g., 23" class="credits-input">
              </div>
          </div>
      </div>
    `

    container.insertAdjacentHTML("beforeend", semesterHTML)
    updateRemoveButtons()
  } catch (error) {
    console.error("Error adding semester:", error)
    showNotification("Error adding semester", "error")
  }
}

function removeSemester(semesterId) {
  try {
    const semesterElement = document.querySelector(`[data-semester="${semesterId}"]`)
    if (semesterElement) {
      semesterElement.remove()
      semesterCount--
      updateRemoveButtons()
    }
  } catch (error) {
    console.error("Error removing semester:", error)
  }
}

function updateRemoveButtons() {
  try {
    const removeButtons = document.querySelectorAll(".remove-semester")
    const semesterItems = document.querySelectorAll(".semester-item")

    removeButtons.forEach((button) => {
      button.style.display = semesterItems.length > 1 ? "block" : "none"
    })
  } catch (error) {
    console.error("Error updating remove buttons:", error)
  }
}

function calculateCGPA() {
  try {
    const semesterItems = document.querySelectorAll(".semester-item")
    const semesters = []

    semesterItems.forEach((item) => {
      const sgpaInput = item.querySelector(".sgpa-input")
      const creditsInput = item.querySelector(".credits-input")

      if (sgpaInput && creditsInput) {
        const sgpa = Number.parseFloat(sgpaInput.value) || 0
        const credits = Number.parseFloat(creditsInput.value) || 0

        if (sgpa > 0 && credits > 0) {
          semesters.push({ sgpa, credits })
        }
      }
    })

    if (semesters.length === 0) {
      showNotification("Please enter valid SGPA and Credits for at least one semester", "error")
      return
    }

    // Send data to backend
    fetch("/api/calculate_cgpa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ semesters }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        if (data.error) {
          showNotification(data.error, "error")
        } else {
          displayCGPAResults(data)
          showNotification("CGPA calculated successfully!", "success")
        }
      })
      .catch((error) => {
        console.error("Error:", error)
        showNotification("Error calculating CGPA. Please try again.", "error")
      })
  } catch (error) {
    console.error("Error in calculateCGPA:", error)
    showNotification("Error calculating CGPA", "error")
  }
}

function displayCGPAResults(data) {
  try {
    const resultsContainer = document.getElementById("cgpaResults")

    if (!resultsContainer) {
      console.error("Results container not found")
      return
    }

    const resultsHTML = `
      <div class="cgpa-result-card">
          <h3>Your CGPA</h3>
          <div class="cgpa-value">${data.cgpa || "N/A"}</div>
          <div class="cgpa-scale">Out of 10.00</div>
      </div>
      
      <div class="gpa-scales">
          <div class="gpa-scale-card">
              <div class="scale-value">${data.gpa_4_scale || "N/A"}</div>
              <div class="scale-label">4.0 Scale (US)</div>
              <div class="scale-formula">Formula: (CGPA - 5) × 4 / 5</div>
          </div>
          <div class="gpa-scale-card">
              <div class="scale-value">${data.gpa_5_scale || "N/A"}</div>
              <div class="scale-label">5.0 Scale</div>
              <div class="scale-formula">Formula: CGPA / 2</div>
          </div>
      </div>
    `

    resultsContainer.innerHTML = resultsHTML
  } catch (error) {
    console.error("Error displaying CGPA results:", error)
  }
}

function resetCGPA() {
  try {
    const container = document.getElementById("semesterContainer")
    if (!container) return

    container.innerHTML = `
      <div class="semester-item" data-semester="1">
          <div class="semester-header">
              <span class="semester-title">Semester 1</span>
              <button class="remove-semester" onclick="removeSemester(1)" style="display: none;" type="button">
                  <i class="fas fa-trash"></i>
              </button>
          </div>
          <div class="semester-inputs">
              <div class="input-group">
                  <label>SGPA</label>
                  <input type="number" step="0.01" min="0" max="10" placeholder="e.g., 8.37" class="sgpa-input">
              </div>
              <div class="input-group">
                  <label>Credits</label>
                  <input type="number" min="0" placeholder="e.g., 23" class="credits-input">
              </div>
          </div>
      </div>
    `

    semesterCount = 1

    const resultsContainer = document.getElementById("cgpaResults")
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-calculator empty-icon"></i>
            <p>Enter your semester details and click "Calculate CGPA" to see your results</p>
        </div>
      `
    }
  } catch (error) {
    console.error("Error resetting CGPA:", error)
  }
}

// Attendance Calculator Functions
function calculateAttendance() {
  try {
    const subjectName = document.getElementById("subjectName")?.value || "Subject"
    const attended = Number.parseInt(document.getElementById("attendedClasses")?.value) || 0
    const total = Number.parseInt(document.getElementById("totalClasses")?.value) || 0
    const minRequired = Number.parseFloat(document.getElementById("minRequired")?.value) || 75

    if (total <= 0) {
      showNotification("Please enter valid attendance data", "error")
      return
    }

    fetch("/api/calculate_attendance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject_name: subjectName,
        attended: attended,
        total: total,
        min_required: minRequired,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        if (data.error) {
          showNotification(data.error, "error")
        } else {
          displayAttendanceResults(data)
        }
      })
      .catch((error) => {
        console.error("Error:", error)
        showNotification("Error calculating attendance. Please try again.", "error")
      })
  } catch (error) {
    console.error("Error in calculateAttendance:", error)
    showNotification("Error calculating attendance", "error")
  }
}

function displayAttendanceResults(data) {
  try {
    const resultsContainer = document.getElementById("attendanceResults")
    if (!resultsContainer) return

    const statusClass = data.status === "safe" ? "safe" : "at-risk"

    const resultsHTML = `
      <div class="attendance-result-card ${statusClass}">
          <h3>Current Attendance</h3>
          <div class="attendance-percentage">${data.current_percent || 0}%</div>
          <div class="attendance-info">${data.attended || 0} out of ${data.total || 0} classes</div>
      </div>
      
      <div class="recommendation-card ${statusClass}">
          <div class="recommendation-message"><strong>${data.message || "No message"}</strong></div>
          <div class="recommendation-text">${data.recommendation || "No recommendation"}</div>
      </div>
    `

    resultsContainer.innerHTML = resultsHTML
  } catch (error) {
    console.error("Error displaying attendance results:", error)
  }
}

function saveAttendanceRecord() {
  try {
    const subjectName = document.getElementById("subjectName")?.value
    const total = Number.parseInt(document.getElementById("totalClasses")?.value) || 0

    if (!subjectName || total <= 0) {
      showNotification("Please enter valid attendance data", "error")
      return
    }

    calculateAttendance()
    showNotification("Attendance record saved successfully!", "success")

    const subjectInput = document.getElementById("subjectName")
    if (subjectInput) {
      subjectInput.value = ""
    }
  } catch (error) {
    console.error("Error saving attendance record:", error)
    showNotification("Error saving attendance record", "error")
  }
}

function resetAttendance() {
  try {
    const elements = ["subjectName", "attendedClasses", "totalClasses"]

    elements.forEach((id) => {
      const element = document.getElementById(id)
      if (element) element.value = ""
    })

    const minRequiredElement = document.getElementById("minRequired")
    if (minRequiredElement) minRequiredElement.value = "75"

    const resultsContainer = document.getElementById("attendanceResults")
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-book-open empty-icon"></i>
            <p>Enter your attendance details to see your status and recommendations</p>
        </div>
      `
    }
  } catch (error) {
    console.error("Error resetting attendance:", error)
  }
}

// Safe holidays loading
function loadHolidays() {
  try {
    console.log("Loading holidays...")
    const container = document.getElementById("holidaysContainer")

    if (!container) {
      console.error("Holidays container not found")
      return
    }

    container.innerHTML = `
      <div class="loading-state">
        <i class="fas fa-spinner fa-spin"></i>
        <p>Loading holidays...</p>
      </div>
    `

    fetch("/api/holidays")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        displayHolidays(data)
      })
      .catch((error) => {
        console.error("Error loading holidays:", error)
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-exclamation-triangle empty-icon"></i>
            <p>Error loading holidays. Please try again later.</p>
          </div>
        `
      })
  } catch (error) {
    console.error("Error in loadHolidays:", error)
  }
}

function displayHolidays(holidays) {
  try {
    const container = document.getElementById("holidaysContainer")
    if (!container) return

    if (!holidays || holidays.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-calendar empty-icon"></i>
            <p>No holidays found</p>
        </div>
      `
      return
    }

    const holidaysHTML = holidays
      .map(
        (holiday) => `
        <div class="holiday-card ${holiday.status || "upcoming"}">
            <div class="holiday-header">
                <div class="holiday-date">${formatDate(holiday.date)}</div>
                <div class="holiday-type ${holiday.type}">${holiday.type.charAt(0).toUpperCase() + holiday.type.slice(1)}</div>
            </div>
            <div class="holiday-name">${holiday.name}</div>
            <div class="holiday-description">${holiday.description}</div>
            ${holiday.countdown ? `<div class="holiday-countdown ${holiday.status || "upcoming"}">${holiday.countdown}</div>` : ""}
        </div>
      `,
      )
      .join("")

    container.innerHTML = holidaysHTML
  } catch (error) {
    console.error("Error displaying holidays:", error)
  }
}

// Safe history loading
function loadHistory() {
  try {
    console.log("Loading history...")
    const cgpaContainer = document.getElementById("cgpaHistory")
    const attendanceContainer = document.getElementById("attendanceHistory")

    if (cgpaContainer) {
      cgpaContainer.innerHTML = `
        <div class="loading-state">
          <i class="fas fa-spinner fa-spin"></i>
          <p>Loading CGPA history...</p>
        </div>
      `
    }

    if (attendanceContainer) {
      attendanceContainer.innerHTML = `
        <div class="loading-state">
          <i class="fas fa-spinner fa-spin"></i>
          <p>Loading attendance history...</p>
        </div>
      `
    }

    fetch("/api/history")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        displayCGPAHistory(data.cgpa || [])
        displayAttendanceHistory(data.attendance || [])
      })
      .catch((error) => {
        console.error("Error loading history:", error)

        if (cgpaContainer) {
          cgpaContainer.innerHTML = `
            <div class="empty-state">
              <i class="fas fa-calculator empty-icon"></i>
              <p>No CGPA calculations yet</p>
            </div>
          `
        }

        if (attendanceContainer) {
          attendanceContainer.innerHTML = `
            <div class="empty-state">
              <i class="fas fa-book-open empty-icon"></i>
              <p>No attendance records yet</p>
            </div>
          `
        }
      })
  } catch (error) {
    console.error("Error in loadHistory:", error)
  }
}

function displayCGPAHistory(history) {
  try {
    const container = document.getElementById("cgpaHistory")
    if (!container) return

    if (!history || history.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-calculator empty-icon"></i>
            <p>No CGPA calculations yet</p>
        </div>
      `
      return
    }

    const historyHTML = history
      .map(
        (record) => `
        <div class="history-card cgpa">
            <div class="history-header">
                <div class="history-date">${formatDate(record.timestamp)}</div>
            </div>
            <div class="history-value cgpa">CGPA: ${record.result?.cgpa || "N/A"}</div>
            <div class="history-details">${record.result?.total_credits || 0} credits • ${record.result?.semesters?.length || 0} semesters</div>
        </div>
      `,
      )
      .join("")

    container.innerHTML = historyHTML
  } catch (error) {
    console.error("Error displaying CGPA history:", error)
  }
}

function displayAttendanceHistory(history) {
  try {
    const container = document.getElementById("attendanceHistory")
    if (!container) return

    if (!history || history.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-book-open empty-icon"></i>
            <p>No attendance records yet</p>
        </div>
      `
      return
    }

    const historyHTML = history
      .map(
        (record) => `
        <div class="history-card attendance">
            <div class="history-header">
                <div class="history-date">${formatDate(record.timestamp)}</div>
            </div>
            <div class="history-value attendance">${record.result?.current_percent || "N/A"}%</div>
            <div class="history-details">
                ${record.result?.subject_name || "Unknown"} • ${record.result?.attended || 0}/${record.result?.total || 0} classes
            </div>
        </div>
      `,
      )
      .join("")

    container.innerHTML = historyHTML
  } catch (error) {
    console.error("Error displaying attendance history:", error)
  }
}

// Utility Functions
function formatDate(dateString) {
  try {
    if (!dateString) return "Invalid Date"
    const date = new Date(dateString)
    if (isNaN(date.getTime())) {
      return "Invalid Date"
    }
    return date.toLocaleDateString("en-IN", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch (error) {
    console.error("Error formatting date:", error)
    return "Invalid Date"
  }
}

function showNotification(message, type = "success") {
  try {
    const notification = document.createElement("div")
    notification.className = `flash-message flash-${type}`
    notification.innerHTML = `
      ${message}
      <button onclick="this.parentElement.remove()" class="flash-close" type="button">&times;</button>
    `

    let container = document.getElementById("flashMessages")
    if (!container) {
      container = document.createElement("div")
      container.id = "flashMessages"
      document.body.appendChild(container)
    }

    container.appendChild(notification)

    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove()
      }
    }, 5000)
  } catch (error) {
    console.error("Error showing notification:", error)
  }
}

// Prevent any global errors from causing page reload
window.addEventListener("error", (e) => {
  console.error("Global error caught:", e.error)
  e.preventDefault()
  return false
})

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason)
  e.preventDefault()
})
