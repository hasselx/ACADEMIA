// Prevent page refresh on button clicks
document.addEventListener("DOMContentLoaded", () => {
  // Prevent all form submissions
  document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault()
    })
  })

  // Set current day to today for timetable
  const today = new Date().getDay()
  currentDayIndex = today === 0 ? 6 : today - 1 // Convert Sunday=0 to our array index
  updateDayDisplay()

  // Initialize tab functionality by setting the default active tab
  // This will also trigger the initial load for the 'reminders' tab
  switchTab("reminders")

  // Force load reminders on page load
  setTimeout(() => {
    console.log("Force loading reminders on page load")
    loadReminders()
  }, 500)

  // Add click event listeners to all tab buttons
  const tabButtons = document.querySelectorAll(".tab-btn")
  tabButtons.forEach((button) => {
    button.addEventListener("click", (e) => {
      e.preventDefault()
      const tabId = button.getAttribute("data-tab")
      console.log("Tab button clicked:", tabId)
      switchTab(tabId)
    })
  })

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

  // Form submission for timetable
  const classForm = document.getElementById("classForm")
  if (classForm) {
    classForm.addEventListener("submit", (e) => {
      e.preventDefault()
      saveClass()
    })
  }

  // Form submission for edit reminder
  const editReminderForm = document.getElementById("editReminderForm")
  if (editReminderForm) {
    editReminderForm.addEventListener("submit", (e) => {
      e.preventDefault()
      updateReminder()
    })
  }

  // Initialize offline system
  checkOnlineStatus()
  updateStorageStatusIndicator()

  // Periodic sync check (every 5 minutes)
  setInterval(() => {
    if (navigator.onLine) {
      syncOfflineData()
    }
    updateStorageStatusIndicator()
  }, 5 * 60 * 1000)

  console.log("Smart Student Dashboard DOM loaded successfully and initial setup complete.")
})

// Global variables
let semesterCount = 1
let currentTab = "reminders" // Initialize with default active tab
let currentDayIndex = 0
let currentTimetable = {}
let editingIndex = -1
let editingReminderId = null

const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

// LocalStorage backup system
const STORAGE_KEYS = {
  REMINDERS: 'smart_reminders_backup',
  TIMETABLE: 'timetable_backup',
  LAST_SYNC: 'last_sync_timestamp'
}

// LocalStorage utility functions
function saveToLocalStorage(key, data) {
  try {
    const dataWithTimestamp = {
      data: data,
      timestamp: new Date().toISOString(),
      version: '1.0'
    }
    localStorage.setItem(key, JSON.stringify(dataWithTimestamp))
    localStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString())
    console.log(`Data saved to LocalStorage: ${key}`)
  } catch (error) {
    console.error('Error saving to LocalStorage:', error)
  }
}

function loadFromLocalStorage(key) {
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      const parsed = JSON.parse(stored)
      console.log(`Data loaded from LocalStorage: ${key}`)
      return parsed.data || parsed // Handle both new and old formats
    }
  } catch (error) {
    console.error('Error loading from LocalStorage:', error)
  }
  return null
}

function clearLocalStorage(key = null) {
  try {
    if (key) {
      localStorage.removeItem(key)
      console.log(`Cleared LocalStorage: ${key}`)
    } else {
      // Clear all app-related storage
      Object.values(STORAGE_KEYS).forEach(storageKey => {
        localStorage.removeItem(storageKey)
      })
      console.log('Cleared all LocalStorage data')
    }
  } catch (error) {
    console.error('Error clearing LocalStorage:', error)
  }
}

function getLastSyncTime() {
  try {
    const lastSync = localStorage.getItem(STORAGE_KEYS.LAST_SYNC)
    return lastSync ? new Date(lastSync) : null
  } catch (error) {
    console.error('Error getting last sync time:', error)
    return null
  }
}

function isDataStale(maxAgeMinutes = 30) {
  const lastSync = getLastSyncTime()
  if (!lastSync) return true

  const now = new Date()
  const ageMinutes = (now - lastSync) / (1000 * 60)
  return ageMinutes > maxAgeMinutes
}

// Backup and restore functions for reminders
function backupRemindersToLocalStorage(reminders) {
  saveToLocalStorage(STORAGE_KEYS.REMINDERS, reminders)
}

function restoreRemindersFromLocalStorage() {
  return loadFromLocalStorage(STORAGE_KEYS.REMINDERS)
}

// Backup and restore functions for timetable
function backupTimetableToLocalStorage(timetable) {
  saveToLocalStorage(STORAGE_KEYS.TIMETABLE, timetable)
}

function restoreTimetableFromLocalStorage() {
  return loadFromLocalStorage(STORAGE_KEYS.TIMETABLE)
}

// Sync and offline management
function syncOfflineData() {
  try {
    const cachedReminders = restoreRemindersFromLocalStorage()
    if (cachedReminders && cachedReminders.reminders) {
      const offlineReminders = cachedReminders.reminders.filter(r => r.offline)

      if (offlineReminders.length > 0) {
        console.log(`Found ${offlineReminders.length} offline reminders to sync`)

        offlineReminders.forEach(reminder => {
          const reminderData = {
            title: reminder.title,
            description: reminder.description,
            type: reminder.type,
            due_date: reminder.due_date
          }

          fetch("/api/reminders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reminderData),
          })
          .then(response => response.json())
          .then(data => {
            if (!data.error) {
              // Remove offline reminder from cache
              cachedReminders.reminders = cachedReminders.reminders.filter(r => r.id !== reminder.id)
              backupRemindersToLocalStorage(cachedReminders)
              console.log("Synced offline reminder:", reminder.title)
            }
          })
          .catch(error => {
            console.error("Error syncing offline reminder:", error)
          })
        })

        if (offlineReminders.length > 0) {
          showNotification(`Syncing ${offlineReminders.length} offline reminders...`, "info")
        }
      }
    }
  } catch (error) {
    console.error("Error syncing offline data:", error)
  }
}

function showOfflineIndicator() {
  const indicator = document.createElement('div')
  indicator.id = 'offline-indicator'
  indicator.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff9800;
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 0.9rem;
      z-index: 1001;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    ">
      <i class="fas fa-wifi-slash"></i> Offline Mode
    </div>
  `
  document.body.appendChild(indicator)
}

function hideOfflineIndicator() {
  const indicator = document.getElementById('offline-indicator')
  if (indicator) {
    indicator.remove()
  }
}

function checkOnlineStatus() {
  if (navigator.onLine) {
    hideOfflineIndicator()
    syncOfflineData()
  } else {
    showOfflineIndicator()
  }
}

// Auto-sync when coming back online
window.addEventListener('online', () => {
  console.log('Connection restored')
  hideOfflineIndicator()
  syncOfflineData()
  updateStorageStatusIndicator()
  showNotification('Connection restored! Syncing data...', 'success')
})

window.addEventListener('offline', () => {
  console.log('Connection lost')
  showOfflineIndicator()
  updateStorageStatusIndicator()
  showNotification('Connection lost. Working in offline mode.', 'warning')
})

// Storage management functions
function getStorageInfo() {
  try {
    const reminders = restoreRemindersFromLocalStorage()
    const timetable = restoreTimetableFromLocalStorage()
    const lastSync = getLastSyncTime()

    const info = {
      hasReminders: !!(reminders && reminders.reminders && reminders.reminders.length > 0),
      reminderCount: reminders ? (reminders.reminders || []).length : 0,
      offlineReminderCount: reminders ? (reminders.reminders || []).filter(r => r.offline).length : 0,
      hasTimetable: !!(timetable && timetable.timetable),
      lastSync: lastSync,
      isStale: isDataStale(),
      storageSize: JSON.stringify(reminders || {}).length + JSON.stringify(timetable || {}).length
    }

    return info
  } catch (error) {
    console.error('Error getting storage info:', error)
    return null
  }
}

function showStorageStatus() {
  const info = getStorageInfo()
  if (!info) return

  const statusMessage = `
    📊 Storage Status:
    • Reminders: ${info.reminderCount} (${info.offlineReminderCount} offline)
    • Timetable: ${info.hasTimetable ? 'Cached' : 'Not cached'}
    • Last sync: ${info.lastSync ? info.lastSync.toLocaleString() : 'Never'}
    • Data age: ${info.isStale ? 'Stale' : 'Fresh'}
    • Storage size: ${(info.storageSize / 1024).toFixed(1)} KB
  `

  console.log(statusMessage)
  showNotification('Storage status logged to console', 'info')
}

function clearAllCache() {
  if (confirm('Are you sure you want to clear all offline data? This cannot be undone.')) {
    clearLocalStorage()
    showNotification('All offline data cleared', 'success')
    updateStorageStatusIndicator()
    loadReminders() // Reload from server
  }
}

function updateStorageStatusIndicator() {
  try {
    const statusElement = document.getElementById('storageStatus')
    const statusTextElement = document.getElementById('storageStatusText')

    if (!statusElement || !statusTextElement) return

    const info = getStorageInfo()
    if (!info) {
      statusTextElement.textContent = 'Error'
      statusElement.className = 'storage-status error'
      return
    }

    const isOnline = navigator.onLine
    const hasOfflineData = info.offlineReminderCount > 0

    if (hasOfflineData) {
      statusTextElement.textContent = `${info.offlineReminderCount} offline`
      statusElement.className = 'storage-status offline'
    } else if (isOnline && info.hasReminders) {
      statusTextElement.textContent = `${info.reminderCount} synced`
      statusElement.className = 'storage-status online'
    } else if (isOnline) {
      statusTextElement.textContent = 'Online'
      statusElement.className = 'storage-status online'
    } else {
      statusTextElement.textContent = 'Offline'
      statusElement.className = 'storage-status offline'
    }

    // Update tooltip
    const tooltip = `
      Reminders: ${info.reminderCount} total, ${info.offlineReminderCount} offline
      Last sync: ${info.lastSync ? info.lastSync.toLocaleString() : 'Never'}
      Status: ${isOnline ? 'Online' : 'Offline'}
    `.trim()
    statusElement.title = tooltip

  } catch (error) {
    console.error('Error updating storage status indicator:', error)
  }
}

// Real-time countdown updates
let countdownInterval = null

function startCountdownUpdates() {
  // Clear existing interval
  if (countdownInterval) {
    clearInterval(countdownInterval)
  }

  // Update countdown every minute
  countdownInterval = setInterval(() => {
    updateCountdownDisplays()
  }, 60000) // 60 seconds
}

function stopCountdownUpdates() {
  if (countdownInterval) {
    clearInterval(countdownInterval)
    countdownInterval = null
  }
}

function updateCountdownDisplays() {
  try {
    const reminderItems = document.querySelectorAll('.reminder-item')
    const now = new Date()

    reminderItems.forEach(item => {
      const countdownElement = item.querySelector('.reminder-countdown')
      if (!countdownElement) return

      // Get due date from the reminder data (we'll need to store it)
      const dueDateAttr = item.getAttribute('data-due-date')
      if (!dueDateAttr) return

      const dueDate = new Date(dueDateAttr)
      const timeDiff = dueDate - now
      const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24))
      const hoursLeft = timeDiff / (1000 * 60 * 60)

      let newCountdown = ''
      let newStatus = ''

      if (daysLeft < 0) {
        newStatus = 'overdue'
        newCountdown = `🚨 ${Math.abs(daysLeft)} days overdue`
      } else if (daysLeft === 0) {
        if (hoursLeft < 0) {
          newStatus = 'overdue'
          newCountdown = '🚨 Overdue today'
        } else if (hoursLeft < 2) {
          newStatus = 'due_now'
          newCountdown = `⏰ Due in ${Math.floor(hoursLeft * 60)} minutes!`
        } else if (hoursLeft < 6) {
          newStatus = 'due_today'
          newCountdown = `📅 Due in ${Math.floor(hoursLeft)} hours`
        } else {
          newStatus = 'due_today'
          newCountdown = '📅 Due today!'
        }
      } else if (daysLeft === 1) {
        newStatus = 'due_tomorrow'
        newCountdown = '📆 Due tomorrow'
      } else {
        newStatus = 'upcoming'
        newCountdown = `🗓️ ${daysLeft} days left`
      }

      // Update the countdown text and class
      countdownElement.textContent = newCountdown
      countdownElement.className = `reminder-countdown ${newStatus}`
    })

    // Update statistics after countdown update
    updateReminderStatistics()
  } catch (error) {
    console.error('Error updating countdown displays:', error)
  }
}

function updateReminderStatistics() {
  try {
    const statsContainer = document.getElementById('reminderStats')
    if (!statsContainer) return

    const reminderItems = document.querySelectorAll('.reminder-item')

    if (reminderItems.length === 0) {
      statsContainer.style.display = 'none'
      return
    }

    let stats = {
      critical: 0,
      urgent: 0,
      overdue: 0,
      dueToday: 0,
      total: reminderItems.length
    }

    reminderItems.forEach(item => {
      const priority = item.getAttribute('data-priority')
      const countdownElement = item.querySelector('.reminder-countdown')

      if (priority === 'critical') stats.critical++
      if (priority === 'urgent') stats.urgent++

      if (countdownElement) {
        const status = countdownElement.className
        if (status.includes('overdue')) stats.overdue++
        if (status.includes('due_today') || status.includes('due_now')) stats.dueToday++
      }
    })

    // Update the display
    document.getElementById('criticalCount').textContent = stats.critical
    document.getElementById('urgentCount').textContent = stats.urgent
    document.getElementById('overdueCount').textContent = stats.overdue
    document.getElementById('dueTodayCount').textContent = stats.dueToday
    document.getElementById('totalCount').textContent = stats.total

    // Show the stats container
    statsContainer.style.display = 'block'

  } catch (error) {
    console.error('Error updating reminder statistics:', error)
  }
}

// Email Settings Functions
function toggleEmailSettings() {
  try {
    const content = document.getElementById('emailSettingsContent')
    const toggleBtn = document.querySelector('.toggle-btn')

    if (content.style.display === 'none') {
      content.style.display = 'block'
      toggleBtn.classList.add('active')
      loadEmailSettings()
    } else {
      content.style.display = 'none'
      toggleBtn.classList.remove('active')
    }
  } catch (error) {
    console.error('Error toggling email settings:', error)
  }
}

function loadEmailSettings() {
  try {
    fetch('/api/reminders/email-settings')
      .then(response => response.json())
      .then(data => {
        if (data.settings) {
          const settings = data.settings
          document.getElementById('emailEnabled').checked = settings.enabled
          document.getElementById('emailAddress').value = settings.email || ''
          document.getElementById('notify24h').checked = settings.notify_24h
          document.getElementById('notify1h').checked = settings.notify_1h
          document.getElementById('notifyOverdue').checked = settings.notify_overdue

          // Show/hide email options based on enabled state
          const emailOptions = document.getElementById('emailOptions')
          emailOptions.style.display = settings.enabled ? 'block' : 'none'
        }
      })
      .catch(error => {
        console.error('Error loading email settings:', error)
        showNotification('Error loading email settings', 'error')
      })
  } catch (error) {
    console.error('Error in loadEmailSettings:', error)
  }
}

function saveEmailSettings() {
  try {
    const settings = {
      enabled: document.getElementById('emailEnabled').checked,
      email: document.getElementById('emailAddress').value.trim(),
      notify_24h: document.getElementById('notify24h').checked,
      notify_1h: document.getElementById('notify1h').checked,
      notify_overdue: document.getElementById('notifyOverdue').checked
    }

    if (settings.enabled && !settings.email) {
      showNotification('Please enter an email address', 'error')
      return
    }

    fetch('/api/reminders/email-settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showNotification('Email settings saved successfully!', 'success')

        // Show/hide email options based on enabled state
        const emailOptions = document.getElementById('emailOptions')
        emailOptions.style.display = settings.enabled ? 'block' : 'none'
      } else {
        showNotification(data.error || 'Error saving email settings', 'error')
      }
    })
    .catch(error => {
      console.error('Error saving email settings:', error)
      showNotification('Error saving email settings', 'error')
    })
  } catch (error) {
    console.error('Error in saveEmailSettings:', error)
  }
}

function sendTestEmail() {
  try {
    const email = document.getElementById('emailAddress').value.trim()

    if (!email) {
      showNotification('Please enter an email address first', 'error')
      return
    }

    const testBtn = document.querySelector('button[onclick="sendTestEmail()"]')
    const originalText = testBtn.innerHTML
    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...'
    testBtn.disabled = true

    fetch('/api/reminders/send-test-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: email })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showNotification('Test email sent successfully! Check your inbox.', 'success')
      } else {
        showNotification(data.error || 'Error sending test email', 'error')
      }
    })
    .catch(error => {
      console.error('Error sending test email:', error)
      showNotification('Error sending test email', 'error')
    })
    .finally(() => {
      testBtn.innerHTML = originalText
      testBtn.disabled = false
    })
  } catch (error) {
    console.error('Error in sendTestEmail:', error)
  }
}

// Add event listener for email enabled checkbox
document.addEventListener('DOMContentLoaded', () => {
  const emailEnabledCheckbox = document.getElementById('emailEnabled')
  if (emailEnabledCheckbox) {
    emailEnabledCheckbox.addEventListener('change', (e) => {
      const emailOptions = document.getElementById('emailOptions')
      emailOptions.style.display = e.target.checked ? 'block' : 'none'
    })
  }
})

// Color schemes for different subjects
const colorSchemes = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
]

// Utility function for time formatting
function formatTime(time) {
  try {
    const [hours, minutes] = time.split(":")
    const hour = Number.parseInt(hours)
    const ampm = hour >= 12 ? "PM" : "AM"
    const displayHour = hour % 12 || 12
    return `${displayHour}:${minutes} ${ampm}`
  } catch (error) {
    console.error("Error formatting time:", error)
    return time
  }
}

// Utility function for notifications
function showNotification(message, type = "success") {
  try {
    // Create notification element
    const notification = document.createElement("div")
    notification.className = `flash-message flash-${type}`
    notification.innerHTML = `
            ${message}
            <button onclick="this.parentElement.remove()" class="flash-close" type="button">&times;</button>
        `

    // Get or create flash messages container
    let flashContainer = document.getElementById("flashMessages")
    if (!flashContainer) {
      flashContainer = document.createElement("div")
      flashContainer.id = "flashMessages"
      document.body.appendChild(flashContainer)
    }

    // Add notification
    flashContainer.appendChild(notification)

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove()
      }
    }, 5000)
  } catch (error) {
    console.error("Error showing notification:", error)
    // Fallback to alert
    alert(message)
  }
}

// Close modal when clicking outside
window.addEventListener("click", (event) => {
  try {
    const addModal = document.getElementById("addModal")
    const editReminderModal = document.getElementById("editReminderModal")

    if (event.target === addModal) {
      closeAddModal()
    }
    if (event.target === editReminderModal) {
      closeEditReminderModal()
    }
  } catch (error) {
    console.error("Error handling window click:", error)
  }
})

// Prevent form submission on Enter key
document.addEventListener("keydown", (event) => {
  try {
    if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") {
      const form = event.target.closest("form")
      if (form) {
        event.preventDefault()
      }
    }
  } catch (error) {
    console.error("Error handling keydown:", error)
  }
})

// Global tab switching function
function switchTab(tabId) {
  console.groupCollapsed(`Attempting to switch to tab: ${tabId}`) // Start a collapsible group in console
  console.log("Step 1: Hiding all tab panes.")
  const allPanes = document.querySelectorAll(".tab-pane")
  allPanes.forEach((pane) => {
    if (pane.classList.contains("active")) {
      pane.classList.remove("active")
      console.log(`Removed 'active' from pane: ${pane.id}`)
    }
    if (pane.style.display !== "none") {
      pane.style.display = "none"
      console.log(`Set display 'none' for pane: ${pane.id}`)
    }
  })

  console.log("Step 2: Deactivating all tab buttons.")
  const allButtons = document.querySelectorAll(".tab-btn")
  allButtons.forEach((btn) => {
    if (btn.classList.contains("active")) {
      btn.classList.remove("active")
      console.log(`Removed 'active' from button: ${btn.getAttribute("data-tab")}`)
    }
  })

  console.log(`Step 3: Activating target tab pane '${tabId}'.`)
  const targetPane = document.getElementById(tabId)
  if (targetPane) {
    targetPane.classList.add("active")
    targetPane.style.display = "block"
    console.log(
      `Added 'active' to pane: ${targetPane.id}. Set display 'block'. Current display: ${targetPane.style.display}`,
    )
  } else {
    console.error(`Error: Tab pane not found for ID: ${tabId}`)
  }

  console.log(`Step 4: Activating target tab button for '${tabId}'.`)
  const clickedButton = document.querySelector(`[data-tab="${tabId}"]`)
  if (clickedButton) {
    clickedButton.classList.add("active")
    console.log(`Added 'active' to button: ${clickedButton.getAttribute("data-tab")}`)
  } else {
    console.error(`Error: Tab button not found for data-tab: ${tabId}`)
  }

  currentTab = tabId
  console.log(`Current active tab (global variable): ${currentTab}`)

  // Load specific data for certain tabs after a short delay
  setTimeout(() => {
    console.log(`Step 5: Loading data for tab: ${tabId}`)
    if (tabId === "holidays") {
      loadHolidays()
    } else if (tabId === "history") {
      loadHistory()
    } else if (tabId === "timetable") {
      loadTimetable()
    } else if (tabId === "reminders") {
      loadReminders()
    }
  }, 100) // Small delay
  console.groupEnd() // End the collapsible group
}

// Smart Reminders Functions
function parseMessage() {
  try {
    const messageText = document.getElementById("messageInput").value.trim()

    if (!messageText) {
      showNotification("Please enter a message to parse", "error")
      return
    }

    // Show loading state
    const parseBtn = document.querySelector('button[onclick="parseMessage()"]')
    const originalText = parseBtn.innerHTML
    parseBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Parsing...'
    parseBtn.disabled = true

    console.log("Fetching /api/reminders/parse...")
    fetch("/api/reminders/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: messageText }),
    })
      .then((response) => {
        console.log("Response from /api/reminders/parse:", response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        console.log("Data from /api/reminders/parse:", data)
        if (data.error) {
          showNotification(data.error, "error")
        } else {
          // Fill the form with parsed data
          document.getElementById("reminderTitle").value = data.title || ""
          document.getElementById("reminderDescription").value = data.description || ""
          document.getElementById("reminderType").value = data.type || "assignment"
          if (data.parsed_date) {
            document.getElementById("reminderDate").value = data.parsed_date
          }

          showNotification("Message parsed successfully! Review and save the reminder.", "success")
        }
      })
      .catch((error) => {
        console.error("Error parsing message:", error)
        showNotification("Error parsing message. Please try again.", "error")
      })
      .finally(() => {
        parseBtn.innerHTML = originalText
        parseBtn.disabled = false
      })
  } catch (error) {
    console.error("Error in parseMessage:", error)
    showNotification("Error parsing message", "error")
  }
}

function clearMessage() {
  try {
    document.getElementById("messageInput").value = ""
    showNotification("Message cleared", "success")
  } catch (error) {
    console.error("Error clearing message:", error)
  }
}

function saveReminder() {
  try {
    const title = document.getElementById("reminderTitle").value.trim()
    const description = document.getElementById("reminderDescription").value.trim()
    const type = document.getElementById("reminderType").value
    const dueDate = document.getElementById("reminderDate").value

    if (!title) {
      showNotification("Please enter a title for the reminder", "error")
      return
    }

    const reminderData = {
      title: title,
      description: description,
      type: type,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
    }

    console.log("Fetching /api/reminders (POST) to save reminder...")
    fetch("/api/reminders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reminderData),
    })
      .then((response) => {
        console.log("Response from /api/reminders (POST):", response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        console.log("✅ Reminder saved to Firebase:", data)
        if (data.error) {
          showNotification(data.error, "error")
        } else {
          showNotification("Reminder saved to Firebase!", "success")
          resetReminderForm()
          loadReminders()
        }
      })
      .catch((error) => {
        console.error("❌ Error saving reminder to Firebase:", error)
        showNotification("Error saving reminder. Please log in and try again.", "error")
      })
  } catch (error) {
    console.error("Error in saveReminder:", error)
    showNotification("Error saving reminder", "error")
  }
}

function cleanupDuplicateReminders() {
  try {
    if (!confirm("This will remove duplicate reminders. Are you sure?")) {
      return
    }

    showNotification("Cleaning up duplicates...", "info")

    fetch("/api/reminders/cleanup-duplicates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      }
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
          showNotification(data.message, "success")
          loadReminders() // Reload to show cleaned data
        }
      })
      .catch((error) => {
        console.error("❌ Error cleaning up duplicates:", error)
        showNotification("Error cleaning up duplicates", "error")
      })
  } catch (error) {
    console.error("Error in cleanupDuplicateReminders:", error)
  }
}

function resetReminderForm() {
  try {
    document.getElementById("reminderTitle").value = ""
    document.getElementById("reminderDescription").value = ""
    document.getElementById("reminderType").value = "assignment"
    document.getElementById("reminderDate").value = ""
    document.getElementById("messageInput").value = ""
  } catch (error) {
    console.error("Error resetting reminder form:", error)
  }
}

function loadReminders() {
  try {
    console.log("🔄 Loading reminders from Firebase...")
    const container = document.getElementById("remindersContainer")

    if (!container) {
      console.error("❌ Reminders container not found!")
      return
    }

    container.innerHTML = `
            <div class="loading-state">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading reminders...</p>
            </div>
        `

    fetch("/api/reminders")
      .then((response) => {
        console.log("🌐 Response from Firebase API:", response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        console.log("📦 Data from Firebase:", data)
        console.log("📊 Reminders count:", data.reminders ? data.reminders.length : 0)

        displayReminders(data.reminders || [])
        if (data.reminders && data.reminders.length > 0) {
          showNotification(`Loaded ${data.reminders.length} reminders from Firebase`, "success")
        }
      })
      .catch((error) => {
        console.error("❌ Error loading reminders from Firebase:", error)
        container.innerHTML = `
                  <div class="empty-state">
                      <i class="fas fa-exclamation-triangle empty-icon"></i>
                      <p>Error loading reminders. Please log in and try again.</p>
                  </div>
              `
        showNotification("Error loading reminders. Please log in.", "error")
      })
  } catch (error) {
    console.error("Error in loadReminders:", error)
  }
}

function enhanceReminderData(reminder) {
  try {
    const now = new Date()
    const enhanced = { ...reminder }

    // Format due date
    if (reminder.due_date) {
      const dueDate = new Date(reminder.due_date)
      enhanced.formatted_due_date = dueDate.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })

      // Calculate countdown and status
      const timeDiff = dueDate - now
      const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24))
      const hoursLeft = timeDiff / (1000 * 60 * 60)

      if (daysLeft < 0) {
        enhanced.status = 'overdue'
        enhanced.countdown = `${Math.abs(daysLeft)} days overdue`
      } else if (daysLeft === 0) {
        if (hoursLeft < 0) {
          enhanced.status = 'overdue'
          enhanced.countdown = 'Overdue today'
        } else if (hoursLeft < 2) {
          enhanced.status = 'due_now'
          enhanced.countdown = `Due in ${Math.floor(hoursLeft * 60)} minutes!`
        } else {
          enhanced.status = 'due_today'
          enhanced.countdown = 'Due today!'
        }
      } else if (daysLeft === 1) {
        enhanced.status = 'due_tomorrow'
        enhanced.countdown = 'Due tomorrow'
      } else {
        enhanced.status = 'upcoming'
        enhanced.countdown = `${daysLeft} days left`
      }
    } else {
      enhanced.status = 'no_date'
      enhanced.countdown = 'No due date'
      enhanced.formatted_due_date = null
    }

    return enhanced
  } catch (error) {
    console.error('Error enhancing reminder data:', error)
    return reminder
  }
}

function displayReminders(reminders) {
  try {
    console.log("🎨 displayReminders called with:", reminders)
    console.log("🎨 Reminders type:", typeof reminders, "Length:", reminders ? reminders.length : "null")

    const container = document.getElementById("remindersContainer")
    if (!container) {
      console.error("❌ remindersContainer not found!")
      return
    }
    console.log("✅ Found container:", container)

    if (!reminders || reminders.length === 0) {
      console.log("❌ No reminders to display, showing empty state")
      container.innerHTML = `
              <div class="empty-state">
                  <i class="fas fa-bell empty-icon"></i>
                  <p>No reminders yet. Add your first reminder above!</p>
              </div>
          `
      return
    }

    console.log("✅ Displaying", reminders.length, "reminders")

    // Enhance reminder data with countdown and formatting
    const enhancedReminders = reminders.map(enhanceReminderData)

    // Sort reminders by priority and due date
    const priorityOrder = { 'critical': 0, 'urgent': 1, 'high': 2, 'medium': 3, 'low': 4 }
    const sortedReminders = [...enhancedReminders].sort((a, b) => {
      // First sort by priority
      const priorityA = priorityOrder[a.priority] || 4
      const priorityB = priorityOrder[b.priority] || 4

      if (priorityA !== priorityB) {
        return priorityA - priorityB
      }

      // Then sort by due date (earlier dates first)
      const dateA = a.due_date ? new Date(a.due_date) : new Date('9999-12-31')
      const dateB = b.due_date ? new Date(b.due_date) : new Date('9999-12-31')

      return dateA - dateB
    })

    console.log("🔧 Enhanced reminders:", enhancedReminders.slice(0, 2)) // Show first 2 for debugging
    console.log("📋 Sorted reminders:", sortedReminders.slice(0, 2)) // Show first 2 for debugging

    const remindersHTML = sortedReminders
      .map((reminder) => {
        const typeEmoji = {
          exam: "📚",
          assignment: "📝",
          project: "🎯",
        }

        // Priority class for enhanced visual feedback
        const priorityClass = reminder.priority ? `priority-${reminder.priority}` : ''

        // Status icons for different countdown states
        const statusIcons = {
          'overdue': '🚨',
          'due_now': '⏰',
          'due_today': '📅',
          'due_tomorrow': '📆',
          'due_soon': '⏳',
          'due_this_week': '📋',
          'upcoming': '🗓️',
          'no_date': '❓'
        }

        const statusIcon = statusIcons[reminder.status] || '📝'

        return `
                  <div class="reminder-item ${reminder.type} ${priorityClass}"
                       data-priority="${reminder.priority || 'low'}"
                       data-due-date="${reminder.due_date || ''}"
                       data-reminder-id="${reminder.id}">
                      <div class="reminder-header">
                          <div class="reminder-type-badge ${reminder.type}">
                              ${typeEmoji[reminder.type] || "📝"} ${reminder.type.charAt(0).toUpperCase() + reminder.type.slice(1)}
                          </div>
                          ${reminder.priority === 'critical' || reminder.priority === 'urgent' ?
                            `<div class="priority-indicator ${reminder.priority}" title="${reminder.priority.toUpperCase()} Priority">
                              ${reminder.priority === 'critical' ? '🔴' : '🟠'}
                            </div>` : ''}
                      </div>
                      <div class="reminder-title">${reminder.title}</div>
                      <div class="reminder-description">${reminder.description || "No description"}</div>
                      ${reminder.formatted_due_date ?
                        `<div class="reminder-due-date">
                          <i class="fas fa-calendar-alt"></i> ${reminder.formatted_due_date}
                        </div>` : ''}
                      <div class="reminder-footer">
                          <div class="reminder-countdown ${reminder.status || "upcoming"}" title="Status: ${reminder.status}">
                            ${statusIcon} ${reminder.countdown || "No due date"}
                          </div>
                          <div class="reminder-actions">
                              <button class="reminder-action-btn" onclick="editReminder('${reminder.id}')" type="button" title="Edit reminder">
                                  <i class="fas fa-edit"></i>
                              </button>
                              <button class="reminder-action-btn delete" onclick="deleteReminder('${reminder.id}')" type="button" title="Delete reminder">
                                  <i class="fas fa-trash"></i>
                              </button>
                          </div>
                      </div>
                  </div>
              `
      })
      .join("")

    console.log("🎨 Generated HTML length:", remindersHTML.length)
    console.log("🎨 First 200 chars of HTML:", remindersHTML.substring(0, 200))

    container.innerHTML = remindersHTML
    console.log("✅ HTML set to container. Container children count:", container.children.length)

    // Update reminder statistics
    updateReminderStatistics()

    // Start real-time countdown updates
    startCountdownUpdates()

    // Update storage status indicator
    updateStorageStatusIndicator()
  } catch (error) {
    console.error("Error displaying reminders:", error)
  }
}

function editReminder(reminderId) {
  try {
    console.log("Editing reminder with ID:", reminderId)
    // Find the reminder data
    fetch("/api/reminders")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        const reminder = data.reminders.find((r) => r.id === reminderId)
        if (!reminder) {
          showNotification("Reminder not found", "error")
          return
        }

        // Fill the edit form
        document.getElementById("editReminderTitle").value = reminder.title || ""
        document.getElementById("editReminderDescription").value = reminder.description || ""
        document.getElementById("editReminderType").value = reminder.type || "assignment"

        if (reminder.due_date) {
          const date = new Date(reminder.due_date)
          document.getElementById("editReminderDate").value = date.toISOString().split("T")[0]
        }

        editingReminderId = reminderId

        // Show the modal
        const modal = document.getElementById("editReminderModal")
        if (modal) modal.style.display = "flex"
      })
      .catch((error) => {
        console.error("Error loading reminder for edit:", error)
        showNotification("Error loading reminder for edit", "error")
      })
  } catch (error) {
    console.error("Error in editReminder:", error)
  }
}

function updateReminder() {
  try {
    if (!editingReminderId) {
      showNotification("No reminder selected for editing", "error")
      return
    }

    const title = document.getElementById("editReminderTitle").value.trim()
    const description = document.getElementById("editReminderDescription").value.trim()
    const type = document.getElementById("editReminderType").value
    const dueDate = document.getElementById("editReminderDate").value

    if (!title) {
      showNotification("Please enter a title for the reminder", "error")
      return
    }

    const reminderData = {
      title: title,
      description: description,
      type: type,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
    }

    console.log("Fetching /api/reminders (PUT) to update reminder:", editingReminderId)
    fetch(`/api/reminders/${editingReminderId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reminderData),
    })
      .then((response) => {
        console.log("Response from /api/reminders (PUT):", response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        console.log("Data from /api/reminders (PUT):", data)
        if (data.error) {
          showNotification(data.error, "error")
        } else {
          showNotification("Reminder updated successfully!", "success")
          closeEditReminderModal()
          loadReminders()
        }
      })
      .catch((error) => {
        console.error("Error updating reminder:", error)
        showNotification("Error updating reminder. Please try again.", "error")
      })
  } catch (error) {
    console.error("Error in updateReminder:", error)
    showNotification("Error updating reminder", "error")
  }
}

function deleteReminder(reminderId) {
  try {
    if (confirm("Are you sure you want to delete this reminder?")) {
      console.log("Fetching /api/reminders (DELETE) to delete reminder:", reminderId)
      fetch(`/api/reminders/${reminderId}`, {
        method: "DELETE",
      })
        .then((response) => {
          console.log("Response from /api/reminders (DELETE):", response.status)
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }
          return response.json()
        })
        .then((data) => {
          console.log("Data from /api/reminders (DELETE):", data)
          if (data.error) {
            showNotification(data.error, "error")
          } else {
            showNotification("Reminder deleted successfully!", "success")
            loadReminders()
          }
        })
        .catch((error) => {
          console.error("Error deleting reminder:", error)
          showNotification("Error deleting reminder. Please try again.", "error")
        })
    }
  } catch (error) {
    console.error("Error in deleteReminder:", error)
    showNotification("Error deleting reminder", "error")
  }
}

function closeEditReminderModal() {
  try {
    const modal = document.getElementById("editReminderModal")
    if (modal) modal.style.display = "none"
    editingReminderId = null
  } catch (error) {
    console.error("Error closing edit reminder modal:", error)
  }
}

// Timetable Functions
function showTimetable() {
  // This function is called by switchTab, so it just needs to load data
  loadTimetable()
}

// Day navigation functions
function changeDay(direction) {
  currentDayIndex += direction
  if (currentDayIndex < 0) currentDayIndex = 6
  if (currentDayIndex > 6) currentDayIndex = 0

  updateDayDisplay()
  displaySchedule()
}

function updateDayDisplay() {
  const dayName = dayNames[currentDayIndex]
  const today = new Date()
  const targetDate = new Date(today)

  // Calculate the target date
  const currentDay = today.getDay()
  const targetDay = currentDayIndex === 6 ? 0 : currentDayIndex + 1 // Convert back to JS day format
  const dayDiff = targetDay - currentDay
  targetDate.setDate(today.getDate() + dayDiff)

  const currentDayElement = document.getElementById("currentDay")
  const currentDateElement = document.getElementById("currentDate")

  if (currentDayElement) currentDayElement.textContent = dayName
  if (currentDateElement) {
    currentDateElement.textContent = targetDate.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
    })
  }
}

// Timetable management functions
function loadTimetable() {
  console.log("Loading timetable from /api/timetable (GET)...")

  // Try to load from LocalStorage first if data is fresh
  const cachedTimetable = restoreTimetableFromLocalStorage()
  if (cachedTimetable && !isDataStale(10)) { // Use cache if less than 10 minutes old
    console.log("Loading timetable from LocalStorage cache")
    currentTimetable = cachedTimetable.timetable || {}
    displaySchedule()
    return
  }

  const container = document.getElementById("scheduleContainer")
  if (container) {
    container.innerHTML = `
            <div class="loading-state">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading timetable...</p>
            </div>
        `
  }

  fetch("/api/timetable")
    .then((response) => {
      console.log("Response from /api/timetable (GET):", response.status)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      return response.json()
    })
    .then((data) => {
      console.log("Data from /api/timetable (GET):", data)
      currentTimetable = data.timetable || {}
      // Backup to LocalStorage
      backupTimetableToLocalStorage(data)
      displaySchedule()
    })
    .catch((error) => {
      console.error("Error loading timetable:", error)

      // Try to load from LocalStorage as fallback
      const cachedTimetable = restoreTimetableFromLocalStorage()
      if (cachedTimetable) {
        console.log("Loading timetable from LocalStorage fallback")
        currentTimetable = cachedTimetable.timetable || {}
        displaySchedule()
        showNotification("Loaded timetable from offline cache", "warning")
      } else {
        if (container) {
          container.innerHTML = `
                      <div class="empty-state">
                          <i class="fas fa-exclamation-triangle empty-icon"></i>
                          <p>Error loading timetable. Please try again later.</p>
                      </div>
                  `
        }
        showNotification("Error loading timetable. Check console for details.", "error")
      }
    })
}

function displaySchedule() {
  const container = document.getElementById("scheduleContainer")
  if (!container) return

  const currentDay = days[currentDayIndex]
  const schedule = currentTimetable[currentDay] || []

  if (schedule.length === 0) {
    container.innerHTML = `
            <div class="empty-schedule">
                <i class="fas fa-calendar-plus empty-icon"></i>
                <p>No classes scheduled for ${dayNames[currentDayIndex]}</p>
                <button class="btn btn-primary" onclick="openAddModal()" type="button">
                    <i class="fas fa-plus"></i> Add Class
                </button>
            </div>
        `
    return
  }

  // Sort schedule by start time
  schedule.sort((a, b) => a.startTime.localeCompare(b.startTime))

  const scheduleHTML = schedule
    .map((classItem, index) => {
      const color = colorSchemes[index % colorSchemes.length]
      const startTime = formatTime(classItem.startTime)
      const endTime = formatTime(classItem.endTime)

      return `
            <div class="schedule-item" style="background-color: ${color}" onclick="editClass(${index})">
                <div class="schedule-number">${index + 1}</div>
                <div class="schedule-content">
                    <div class="schedule-time">
                        <div class="time-start">${startTime}</div>
                        <div class="time-end">${endTime}</div>
                    </div>
                    <div class="schedule-details">
                        <div class="subject-name">${classItem.subjectName}</div>
                        <div class="teacher-name">${classItem.teacherName || "No teacher assigned"}</div>
                        ${classItem.roomNumber ? `<div class="room-info"><i class="fas fa-map-marker-alt"></i> ${classItem.roomNumber}</div>` : ""}
                        ${classItem.classType ? `<div class="class-type">${classItem.classType.charAt(0).toUpperCase() + classItem.classType.slice(1)}</div>` : ""}
                    </div>
                </div>
                <div class="schedule-actions">
                    <button class="action-btn edit-btn" onclick="event.stopPropagation(); editClass(${index})" type="button">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn delete-btn" onclick="event.stopPropagation(); deleteClass(${index})" type="button">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `
    })
    .join("")

  container.innerHTML = scheduleHTML
}

// Modal functions
function openAddModal() {
  editingIndex = -1
  const modalTitle = document.getElementById("modalTitle")
  const classForm = document.getElementById("classForm")

  if (modalTitle) modalTitle.textContent = "Add New Class"
  if (classForm) classForm.reset()

  const modal = document.getElementById("addModal")
  if (modal) modal.style.display = "flex"
}

function closeAddModal() {
  const modal = document.getElementById("addModal")
  if (modal) modal.style.display = "none"
  editingIndex = -1
}

function editClass(index) {
  const currentDay = days[currentDayIndex]
  const schedule = currentTimetable[currentDay] || []
  const classItem = schedule[index]

  if (!classItem) return

  editingIndex = index
  const modalTitle = document.getElementById("modalTitle")
  if (modalTitle) modalTitle.textContent = "Edit Class"

  // Fill form with existing data
  const startTimeInput = document.getElementById("startTime")
  const endTimeInput = document.getElementById("endTime")
  const subjectNameInput = document.getElementById("subjectNameModal")
  const teacherNameInput = document.getElementById("teacherName")
  const roomNumberInput = document.getElementById("roomNumber")
  const classTypeInput = document.getElementById("classType")

  if (startTimeInput) startTimeInput.value = classItem.startTime
  if (endTimeInput) endTimeInput.value = classItem.endTime
  if (subjectNameInput) subjectNameInput.value = classItem.subjectName
  if (teacherNameInput) teacherNameInput.value = classItem.teacherName || ""
  if (roomNumberInput) roomNumberInput.value = classItem.roomNumber || ""
  if (classTypeInput) classTypeInput.value = classItem.classType || "lecture"

  const modal = document.getElementById("addModal")
  if (modal) modal.style.display = "flex"
}

function deleteClass(index) {
  if (confirm("Are you sure you want to delete this class?")) {
    const currentDay = days[currentDayIndex]
    if (!currentTimetable[currentDay]) return

    currentTimetable[currentDay].splice(index, 1)
    saveTimetable()
    displaySchedule()
    showNotification("Class deleted successfully", "success")
  }
}

function saveClass() {
  const formData = {
    startTime: document.getElementById("startTime").value,
    endTime: document.getElementById("endTime").value,
    subjectName: document.getElementById("subjectNameModal").value,
    teacherName: document.getElementById("teacherName").value,
    roomNumber: document.getElementById("roomNumber").value,
    classType: document.getElementById("classType").value,
  }

  // Validation
  if (!formData.startTime || !formData.endTime || !formData.subjectName) {
    showNotification("Please fill in all required fields", "error")
    return
  }

  if (formData.startTime >= formData.endTime) {
    showNotification("End time must be after start time", "error")
    return
  }

  const currentDay = days[currentDayIndex]
  if (!currentTimetable[currentDay]) {
    currentTimetable[currentDay] = []
  }

  if (editingIndex >= 0) {
    // Edit existing class
    currentTimetable[currentDay][editingIndex] = formData
    showNotification("Class updated successfully", "success")
  } else {
    // Add new class
    currentTimetable[currentDay].push(formData)
    showNotification("Class added successfully", "success")
  }

  saveTimetable()
  displaySchedule()
  closeAddModal()
}

function saveTimetable() {
  console.log("Fetching /api/timetable (POST) to save timetable...")
  fetch("/api/timetable", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timetable: currentTimetable,
    }),
  })
    .then((response) => {
      console.log("Response from /api/timetable (POST):", response.status)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      return response.json()
    })
    .then((data) => {
      console.log("Data from /api/timetable (POST):", data)
      if (data.error) {
        showNotification(data.error, "error")
      }
    })
    .catch((error) => {
      console.error("Error saving timetable:", error)
      showNotification("Error saving timetable", "error")
    })
}

// CGPA Functions
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

    console.log("Fetching /api/calculate_cgpa (POST) to calculate CGPA...")
    fetch("/api/calculate_cgpa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ semesters }),
    })
      .then((response) => {
        console.log("Response from /api/calculate_cgpa (POST):", response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        console.log("Data from /api/calculate_cgpa (POST):", data)
        if (data.error) {
          showNotification(data.error, "error")
        } else {
          displayCGPAResults(data)
          showNotification("CGPA calculated successfully!", "success")
        }
      })
      .catch((error) => {
        console.error("Error calculating CGPA:", error)
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

    showNotification("CGPA calculator reset", "success")
  } catch (error) {
    console.error("Error resetting CGPA:", error)
  }
}

// Attendance Functions
function calculateAttendance() {
  try {
    const attended = Number.parseInt(document.getElementById("attendedClasses").value) || 0
    const total = Number.parseInt(document.getElementById("totalClasses").value) || 0
    const minRequired = Number.parseFloat(document.getElementById("minRequired").value) || 75
    const subjectName = document.getElementById("subjectName").value || "Subject"

    if (total <= 0) {
      showNotification("Total classes must be greater than 0", "error")
      return
    }

    if (attended > total) {
      showNotification("Attended classes cannot exceed total classes", "error")
      return
    }

    console.log("Fetching /api/calculate_attendance (POST) to calculate attendance...")
    fetch("/api/calculate_attendance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attended,
        total,
        min_required: minRequired,
        subject_name: subjectName,
      }),
    })
      .then((response) => {
        console.log("Response from /api/calculate_attendance (POST):", response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        console.log("Data from /api/calculate_attendance (POST):", data)
        if (data.error) {
          showNotification(data.error, "error")
        } else {
          displayAttendanceResults(data)
          showNotification("Attendance calculated successfully!", "success")
        }
      })
      .catch((error) => {
        console.error("Error calculating attendance:", error)
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

    if (!resultsContainer) {
      console.error("Attendance results container not found")
      return
    }

    const statusClass = data.status === "safe" ? "safe" : "at-risk"

    const resultsHTML = `
            <div class="attendance-result-card ${statusClass}">
                <h3>Your Attendance</h3>
                <div class="attendance-percentage">${data.current_percent}%</div>
                <div class="attendance-details">
                    ${data.attended} out of ${data.total} classes attended
                </div>
            </div>
            
            <div class="recommendation-card ${statusClass}">
                <h4>${data.message}</h4>
                <p>${data.recommendation}</p>
            </div>
        `

    resultsContainer.innerHTML = resultsHTML
  } catch (error) {
    console.error("Error displaying attendance results:", error)
  }
}

function saveAttendanceRecord() {
  try {
    const attended = Number.parseInt(document.getElementById("attendedClasses").value) || 0
    const total = Number.parseInt(document.getElementById("totalClasses").value) || 0
    const minRequired = Number.parseFloat(document.getElementById("minRequired").value) || 75
    const subjectName = document.getElementById("subjectName").value || "Unknown Subject"

    if (total <= 0) {
      showNotification("Total classes must be greater than 0", "error")
      return
    }

    if (attended > total) {
      showNotification("Attended classes cannot exceed total classes", "error")
      return
    }

    // First, calculate attendance to get the result object
    fetch("/api/calculate_attendance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attended,
        total,
        min_required: minRequired,
        subject_name: subjectName,
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
          // The /api/calculate_attendance endpoint already saves to history,
          // so we just need to display the results and confirm.
          displayAttendanceResults(data)
          showNotification("Attendance record saved successfully!", "success")
          // Optionally, you might want to load history to see the new record
          // if the user switches to the history tab.
        }
      })
      .catch((error) => {
        console.error("Error saving attendance record:", error)
        showNotification("Error saving attendance record. Please try again.", "error")
      })
  } catch (error) {
    console.error("Error in saveAttendanceRecord:", error)
    showNotification("Error saving attendance record", "error")
  }
}

function resetAttendance() {
  try {
    document.getElementById("subjectName").value = ""
    document.getElementById("attendedClasses").value = ""
    document.getElementById("totalClasses").value = ""
    document.getElementById("minRequired").value = "75"

    const resultsContainer = document.getElementById("attendanceResults")
    if (resultsContainer) {
      resultsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-book-open empty-icon"></i>
                    <p>Enter your attendance details to see your status and recommendations</p>
                </div>
            `
    }

    showNotification("Attendance calculator reset", "success")
  } catch (error) {
    console.error("Error resetting attendance:", error)
  }
}

// Holidays Functions
function loadHolidays() {
  try {
    console.log("Loading holidays from /api/holidays (GET)...")
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
        console.log("Response from /api/holidays (GET):", response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((holidays) => {
        console.log("Data from /api/holidays (GET):", holidays)
        displayHolidays(holidays)
      })
      .catch((error) => {
        console.error("Error loading holidays:", error)
        container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-exclamation-triangle empty-icon"></i>
                        <p>Error loading holidays. Please try again later.</p>
                    </div>
                `
        showNotification("Error loading holidays. Check console for details.", "error")
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
      .map((holiday) => {
        return `
                  <div class="holiday-card ${holiday.status || ""}">
                      <div class="holiday-header">
                          <div class="holiday-date">${new Date(holiday.date).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}</div>
                          <div class="holiday-type ${holiday.type}">${holiday.type}</div>
                      </div>
                      <div class="holiday-name">${holiday.name}</div>
                      <div class="holiday-description">${holiday.description}</div>
                      ${
                        holiday.countdown
                          ? `<div class="holiday-countdown ${holiday.status}">${holiday.countdown}</div>`
                          : ""
                      }
                  </div>
              `
      })
      .join("")

    container.innerHTML = holidaysHTML
  } catch (error) {
    console.error("Error displaying holidays:", error)
  }
}

// History Functions
function loadHistory() {
  try {
    console.log("Loading history from /api/history (GET)...")

    const cgpaContainer = document.getElementById("cgpaHistory")
    const attendanceContainer = document.getElementById("attendanceHistory")

    if (cgpaContainer) {
      cgpaContainer.innerHTML = `
              <div class="loading-state">
                  <i class="fas fa-spinner fa-spin"></i>
                  <p>Loading history...</p>
              </div>
          `
    }

    if (attendanceContainer) {
      attendanceContainer.innerHTML = `
              <div class="loading-state">
                  <i class="fas fa-spinner fa-spin"></i>
                  <p>Loading history...</p>
              </div>
          `
    }

    fetch("/api/history")
      .then((response) => {
        console.log("Response from /api/history (GET):", response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        console.log("Data from /api/history (GET):", data)
        displayHistory(data)
      })
      .catch((error) => {
        console.error("Error loading history:", error)
        if (cgpaContainer) {
          cgpaContainer.innerHTML = `
                      <div class="empty-state">
                          <i class="fas fa-exclamation-triangle empty-icon"></i>
                          <p>Error loading history</p>
                      </div>
                  `
        }
        if (attendanceContainer) {
          attendanceContainer.innerHTML = `
                      <div class="empty-state">
                          <i class="fas fa-exclamation-triangle empty-icon"></i>
                          <p>Error loading history</p>
                      </div>
                  `
        }
        showNotification("Error loading history. Check console for details.", "error")
      })
  } catch (error) {
    console.error("Error in loadHistory:", error)
  }
}

function displayHistory(data) {
  try {
    const cgpaContainer = document.getElementById("cgpaHistory")
    const attendanceContainer = document.getElementById("attendanceHistory")

    // Display CGPA history
    if (cgpaContainer) {
      if (!data.cgpa || data.cgpa.length === 0) {
        cgpaContainer.innerHTML = `
                  <div class="empty-state">
                      <i class="fas fa-calculator empty-icon"></i>
                      <p>No CGPA calculations found</p>
                  </div>
              `
      } else {
        const cgpaHTML = data.cgpa
          .map((record) => {
            const result = record.result
            return `
                          <div class="history-card cgpa">
                              <div class="history-header">
                                  <div class="history-date">${new Date(record.timestamp).toLocaleDateString()}</div>
                              </div>
                              <div class="history-value cgpa">${result.cgpa}</div>
                              <div class="history-details">
                                  CGPA: ${result.cgpa}/10.0<br>
                                  Total Credits: ${result.total_credits}<br>
                                  4.0 Scale: ${result.gpa_4_scale}
                              </div>
                          </div>
                      `
          })
          .join("")
        cgpaContainer.innerHTML = cgpaHTML
      }
    }

    // Display Attendance history
    if (attendanceContainer) {
      if (!data.attendance || data.attendance.length === 0) {
        attendanceContainer.innerHTML = `
                  <div class="empty-state">
                      <i class="fas fa-book-open empty-icon"></i>
                      <p>No attendance records found</p>
                  </div>
              `
      } else {
        const attendanceHTML = data.attendance
          .map((record) => {
            const result = record.result
            return `
                          <div class="history-card attendance">
                              <div class="history-header">
                                  <div class="history-date">${new Date(record.timestamp).toLocaleDateString()}</div>
                              </div>
                              <div class="history-value attendance">${result.current_percent}%</div>
                              <div class="history-details">
                                  Subject: ${result.subject_name}<br>
                                  ${result.attended}/${result.total} classes<br>
                                  Status: ${result.status}
                              </div>
                          </div>
                      `
          })
          .join("")
        attendanceContainer.innerHTML = attendanceHTML
      }
    }
  } catch (error) {
    console.error("Error displaying history:", error)
  }
}

// Test function to test tab switching
function testTabs() {
  console.log("Testing all tabs...")
  const tabs = ["reminders", "cgpa", "attendance", "holidays", "history", "timetable"]

  tabs.forEach((tab, index) => {
    setTimeout(() => {
      console.log(`Testing tab: ${tab}`)
      switchTab(tab)
    }, index * 1000) // 1 second delay between each tab switch
  })
}
