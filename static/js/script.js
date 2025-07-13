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

  // Add event listeners for time dropdowns
  const timeDropdowns = ['reminderTimeHour', 'reminderTimeMinute', 'reminderTimeAmPm',
                        'editReminderTimeHour', 'editReminderTimeMinute', 'editReminderTimeAmPm']

  timeDropdowns.forEach(id => {
    const element = document.getElementById(id)
    if (element) {
      element.addEventListener('change', () => {
        const prefix = id.includes('edit') ? 'editReminder' : 'reminder'
        updateHiddenTimeField(prefix)
      })
    }
  })

  // Periodic sync check (every 5 minutes)
  setInterval(() => {
    if (navigator.onLine) {
      syncOfflineData()
    }
    updateStorageStatusIndicator()
  }, 5 * 60 * 1000)

  console.log("Smart Student Dashboard DOM loaded successfully and initial setup complete.")

  // Test countdown on page load
  setTimeout(() => {
    console.log('🧪 Testing countdown functionality...')
    loadExamCountdown()
  }, 2000)
})

// Global variables
let semesterCount = 1
let currentTab = "reminders" // Initialize with default active tab
let currentDayIndex = 0
let currentTimetable = {}
let currentExamTimetable = { exams: [] }
let currentTimetableType = 'normal' // 'normal' or 'exam'
let editingIndex = -1
let editingExamIndex = -1
let editingReminderId = null
let allReminders = [] // Store all reminders for filtering
let examCountdownInterval = null

// Time format conversion functions
function convertTo24Hour(hour, minute, ampm) {
  if (!hour || !ampm) return null

  let hour24 = parseInt(hour)
  const min = minute || '00'

  if (ampm === 'AM') {
    if (hour24 === 12) hour24 = 0
  } else if (ampm === 'PM') {
    if (hour24 !== 12) hour24 += 12
  }

  return `${hour24.toString().padStart(2, '0')}:${min}`
}

function convertTo12Hour(time24) {
  if (!time24) return { hour: '', minute: '', ampm: '' }

  const [hours, minutes] = time24.split(':')
  let hour = parseInt(hours)
  const ampm = hour >= 12 ? 'PM' : 'AM'

  if (hour === 0) hour = 12
  else if (hour > 12) hour -= 12

  return {
    hour: hour.toString(),
    minute: minutes,
    ampm: ampm
  }
}

function updateHiddenTimeField(prefix = 'reminder') {
  const hour = document.getElementById(`${prefix}TimeHour`).value
  const minute = document.getElementById(`${prefix}TimeMinute`).value
  const ampm = document.getElementById(`${prefix}TimeAmPm`).value

  const time24 = convertTo24Hour(hour, minute, ampm)
  document.getElementById(`${prefix}Time`).value = time24 || ''
}

function setTimeFields(prefix, time24) {
  const { hour, minute, ampm } = convertTo12Hour(time24)

  document.getElementById(`${prefix}TimeHour`).value = hour
  document.getElementById(`${prefix}TimeMinute`).value = minute
  document.getElementById(`${prefix}TimeAmPm`).value = ampm

  updateHiddenTimeField(prefix)
}

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

function fixReminderTimes() {
  if (!confirm('This will update reminder times by re-parsing their descriptions. Continue?')) {
    return
  }

  console.log("Fixing reminder times...")

  fetch('/api/reminders/fix-times', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      showNotification(`✅ ${data.message}`, 'success')
      // Reload reminders to show updated times
      loadReminders()
    } else {
      showNotification(`❌ ${data.error || data.message}`, 'error')
    }
  })
  .catch(error => {
    console.error('Error fixing reminder times:', error)
    showNotification('❌ Error fixing reminder times', 'error')
  })
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

  // Update countdown more frequently for time-sensitive reminders
  countdownInterval = setInterval(() => {
    updateCountdownDisplays()
  }, 30000) // 30 seconds for better real-time updates
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

    console.log(`🔄 updateCountdownDisplays: Processing ${reminderItems.length} items`)

    reminderItems.forEach(item => {
      const countdownElement = item.querySelector('.reminder-countdown')
      if (!countdownElement) return

      // Get due date from the reminder data (we'll need to store it)
      const dueDateAttr = item.getAttribute('data-due-date')
      if (!dueDateAttr) return

      const reminderId = item.getAttribute('data-reminder-id')
      console.log(`🔍 Processing reminder ${reminderId}: due_date="${dueDateAttr}"`)

      // Parse the date more robustly to handle timezone formats
      let dueDate
      try {
        // Clean up corrupted date formats
        let dateStr = dueDateAttr

        // Handle the +00:00Z format by converting it to a standard ISO format
        if (dateStr.includes('+00:00Z')) {
          dateStr = dateStr.replace('+00:00Z', 'Z')
        }

        // Fix dates with double timezone suffixes like +00:00+00:00
        const doubleTzPattern = /(\+\d{2}:\d{2})\+\d{2}:\d{2}$/
        if (doubleTzPattern.test(dateStr)) {
          dateStr = dateStr.replace(doubleTzPattern, '$1')
        }
        dueDate = new Date(dateStr)

        // Validate the date
        if (isNaN(dueDate.getTime())) {
          console.warn('Invalid date format:', dueDateAttr)
          return
        }
      } catch (error) {
        console.error('Error parsing date:', dueDateAttr, error)
        return
      }

      let newCountdown = ''
      let newStatus = ''

      // Compare dates properly - use date-only comparison for day calculations
      const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const dueOnlyDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
      const daysDiff = Math.floor((dueOnlyDate - nowDate) / (1000 * 60 * 60 * 24))



      // Use full datetime comparison instead of date-only comparison
      const timeDiff = dueDate.getTime() - now.getTime()



      if (timeDiff < 0) {
        // Past due - calculate how long overdue
        const hoursOverdue = Math.floor(Math.abs(timeDiff) / (1000 * 60 * 60))
        const minutesOverdue = Math.floor((Math.abs(timeDiff) % (1000 * 60 * 60)) / (1000 * 60))

        newStatus = 'overdue'
        if (daysDiff < -1) {
          // More than 1 day overdue
          const daysOverdue = Math.abs(daysDiff)
          newCountdown = `🚨 ${daysOverdue} days overdue`
        } else if (hoursOverdue >= 24) {
          // More than 24 hours overdue
          const daysOverdue = Math.floor(hoursOverdue / 24)
          newCountdown = `🚨 ${daysOverdue} days overdue`
        } else if (hoursOverdue > 0) {
          // Hours overdue
          newCountdown = `🚨 Overdue by ${hoursOverdue}h ${minutesOverdue}m`
        } else {
          // Minutes overdue
          newCountdown = `🚨 Overdue by ${minutesOverdue}m`
        }
      } else if (timeDiff < 60 * 60 * 1000) {
        // Due within 1 hour
        const minutesLeft = Math.floor(timeDiff / (1000 * 60))
        newStatus = 'due_now'
        newCountdown = `⏰ Due in ${minutesLeft}m`
      } else if (timeDiff < 3 * 60 * 60 * 1000) {
        // Due within 3 hours
        const hoursLeft = Math.floor(timeDiff / (1000 * 60 * 60))
        const minutesLeft = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60))
        newStatus = 'due_soon'
        newCountdown = `⏳ Due in ${hoursLeft}h ${minutesLeft}m`
      } else if (daysDiff === 0) {
        // Due later today
        const timeString = dueDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        newStatus = 'due_today'
        newCountdown = `📅 Due today at ${timeString}`
      } else if (daysDiff === 1) {
        newStatus = 'due_tomorrow'
        newCountdown = '📆 Due tomorrow'
      } else {
        newStatus = 'upcoming'
        newCountdown = `🗓️ ${daysDiff} days left`
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
        if (status.includes('due_today') || status.includes('due_now') || status.includes('due_soon')) stats.dueToday++
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

          // Make email field read-only since it comes from registration
          document.getElementById('emailAddress').readOnly = true
          document.getElementById('emailAddress').style.backgroundColor = '#f8f9fa'
          document.getElementById('emailAddress').title = 'Email address from your registration (cannot be changed here)'

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
      notify_24h: document.getElementById('notify24h').checked,
      notify_1h: document.getElementById('notify1h').checked,
      notify_overdue: document.getElementById('notifyOverdue').checked
      // Note: email is not sent - backend uses registration email automatically
    }

    // No need to validate email since it comes from registration

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
      showNotification('No email address found in your profile', 'error')
      return
    }

    const testBtn = document.querySelector('button[onclick="sendTestEmail()"]')
    const originalText = testBtn.innerHTML
    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...'
    testBtn.disabled = true

    // No need to send email in body - backend uses registration email
    fetch('/api/reminders/send-test-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
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

function checkEmailNotifications() {
  try {
    const checkBtn = document.querySelector('button[onclick="checkEmailNotifications()"]')
    const originalText = checkBtn.innerHTML
    checkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...'
    checkBtn.disabled = true

    fetch('/api/reminders/check-email-notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        const message = data.notifications_sent > 0
          ? `✅ Email check completed! Sent ${data.notifications_sent} notification(s).`
          : '✅ Email check completed! No notifications needed at this time.'
        showNotification(message, 'success')
      } else {
        showNotification(data.error || 'Failed to check email notifications', 'error')
      }
    })
    .catch(error => {
      console.error('Error checking email notifications:', error)
      showNotification('Error checking email notifications', 'error')
    })
    .finally(() => {
      checkBtn.innerHTML = originalText
      checkBtn.disabled = false
    })
  } catch (error) {
    console.error('Error in checkEmailNotifications:', error)
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
      loadCalendar()
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
          if (data.parsed_time) {
            setTimeFields('reminder', data.parsed_time)
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

    // Update hidden time field before getting its value
    updateHiddenTimeField('reminder')
    const dueTime = document.getElementById("reminderTime").value

    if (!title) {
      showNotification("Please enter a title for the reminder", "error")
      return
    }

    // Combine date and time if both are provided
    let dueDateTimeISO = null
    if (dueDate) {
      let dateTime = new Date(dueDate)

      if (dueTime) {
        // Parse time and set it on the date
        const [hours, minutes] = dueTime.split(':')
        dateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
      } else {
        // Set default time based on reminder type
        if (type === 'assignment' || type === 'project') {
          dateTime.setHours(23, 59, 0, 0) // 11:59 PM for assignments/projects
        } else if (type === 'exam') {
          dateTime.setHours(9, 0, 0, 0) // 9:00 AM for exams
        } else if (type === 'lab') {
          dateTime.setHours(14, 0, 0, 0) // 2:00 PM for labs
        } else {
          dateTime.setHours(23, 59, 0, 0) // Default to end of day
        }
      }

      dueDateTimeISO = dateTime.toISOString()
    }

    const reminderData = {
      title: title,
      description: description,
      type: type,
      due_date: dueDateTimeISO,
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
    document.getElementById("reminderTime").value = ""
    document.getElementById("reminderTimeHour").value = ""
    document.getElementById("reminderTimeMinute").value = ""
    document.getElementById("reminderTimeAmPm").value = ""
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

        // Debug all reminders to see what we have
        if (data.reminders) {
          console.log("🔍 ALL REMINDERS DEBUG:")
          data.reminders.forEach((reminder, index) => {
            console.log(`  ${index}: ${reminder.title}`)
            console.log(`    due_date: ${reminder.due_date}`)
            console.log(`    due_time: ${reminder.due_time}`)
            console.log(`    description: ${reminder.description}`)
          })
        }

        allReminders = data.reminders || []
        displayReminders(allReminders)
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

// Store parsed times in memory to persist during session
const parsedTimes = new Map()

// Debug: Log when the script loads
console.log('🔧 Script loaded with time parsing fix v2.0')

// Function to get or parse time for a reminder
function getOrParseTime(reminder) {
  // Check if we already parsed this reminder's time
  if (parsedTimes.has(reminder.id)) {
    return parsedTimes.get(reminder.id)
  }

  // If reminder already has due_time, use it
  if (reminder.due_time) {
    parsedTimes.set(reminder.id, reminder.due_time)
    return reminder.due_time
  }

  // Try to parse time from description
  if (reminder.description) {
    const timeMatch = reminder.description.match(/\b(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)\b/)
    if (timeMatch) {
      let hours = parseInt(timeMatch[1])
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0
      const ampm = timeMatch[3].toLowerCase()

      // Convert to 24-hour format
      if (ampm === 'pm' && hours !== 12) {
        hours += 12
      } else if (ampm === 'am' && hours === 12) {
        hours = 0
      }

      const parsedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
      parsedTimes.set(reminder.id, parsedTime)

      console.log(`⏰ Parsed time for ${reminder.title}: ${timeMatch[0]} -> ${parsedTime}`)
      return parsedTime
    }
  }

  // No time found
  return null
}

function enhanceReminderData(reminder) {
  try {
    const now = new Date()
    const enhanced = { ...reminder }

    // Debug problematic reminders
    if (reminder.title && (reminder.title.includes('MAJOR') || reminder.title.includes('OPERATION RESEARCH') || reminder.title.includes('COMPUTER'))) {
      console.log(`🔧 Enhancing ${reminder.title}:`)
      console.log('  Original due_date:', reminder.due_date)
      console.log('  Original due_time:', reminder.due_time)
    }



    // Format due date
    if (reminder.due_date) {
      // Clean up the date string to handle various corrupted formats
      let cleanedDateStr = reminder.due_date

      // Fix dates with timezone + Z like +00:00Z
      if (cleanedDateStr.includes('+00:00Z')) {
        cleanedDateStr = cleanedDateStr.replace('+00:00Z', 'Z')
      }

      // Fix dates with double timezone suffixes like +00:00+00:00
      const doubleTzPattern = /(\+\d{2}:\d{2})\+\d{2}:\d{2}$/
      if (doubleTzPattern.test(cleanedDateStr)) {
        cleanedDateStr = cleanedDateStr.replace(doubleTzPattern, '$1')
      }

      let dueDate = new Date(cleanedDateStr)

      // Get or parse time for this reminder
      const dueTime = getOrParseTime(reminder)
      if (dueTime) {
        enhanced.due_time = dueTime

        // Parse the time and set it on the due date
        const [hours, minutes] = dueTime.split(':').map(Number)
        dueDate.setHours(hours, minutes, 0, 0)

        // Update the enhanced due_date to include the parsed time
        enhanced.due_date = dueDate.toISOString()

        console.log(`⏰ Using time for ${reminder.title}: ${dueTime}`)
        console.log(`  Updated dueDate:`, dueDate)
        console.log(`  Enhanced due_date:`, enhanced.due_date)
      } else if (reminder.due_time) {
        // Use existing due_time if available
        const [hours, minutes] = reminder.due_time.split(':').map(Number)
        dueDate.setHours(hours, minutes, 0, 0)

        // Update the enhanced due_date to include the existing time
        enhanced.due_date = dueDate.toISOString()
      }

      // Debug problematic reminders
      if (reminder.title && (reminder.title.includes('MAJOR') || reminder.title.includes('OPERATION RESEARCH') || reminder.title.includes('COMPUTER'))) {
        console.log(`  Cleaned date string: "${cleanedDateStr}"`)
        console.log(`  Parsed dueDate:`, dueDate)
        console.log(`  dueDate.getTime():`, dueDate.getTime())
        console.log(`  Current time:`, now)
      }

      // Validate the date
      if (isNaN(dueDate.getTime())) {
        console.warn('Invalid date format in enhanceReminderData:', reminder.due_date, 'cleaned:', cleanedDateStr)
        // Set fallback values
        enhanced.status = 'no_date'
        enhanced.priority = 'low'
        enhanced.countdown = 'No due date'
        enhanced.formatted_due_date = 'No due date'
        return enhanced
      }

      enhanced.formatted_due_date = dueDate.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })



      // Calculate countdown and status - use date-only comparison for accuracy

      // Compare dates properly - use date-only comparison for day calculations
      const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const dueOnlyDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
      const daysDiff = Math.floor((dueOnlyDate - nowDate) / (1000 * 60 * 60 * 24))

      // Use full datetime comparison instead of date-only comparison
      const timeDiff = dueDate.getTime() - now.getTime()



      if (timeDiff < 0) {
        // Past due - calculate how long overdue
        const hoursOverdue = Math.floor(Math.abs(timeDiff) / (1000 * 60 * 60))
        const minutesOverdue = Math.floor((Math.abs(timeDiff) % (1000 * 60 * 60)) / (1000 * 60))

        enhanced.status = 'overdue'
        enhanced.priority = 'critical'
        if (daysDiff < -1) {
          // More than 1 day overdue
          const daysOverdue = Math.abs(daysDiff)
          enhanced.countdown = `${daysOverdue} days overdue`
        } else if (hoursOverdue >= 24) {
          // More than 24 hours overdue
          const daysOverdue = Math.floor(hoursOverdue / 24)
          enhanced.countdown = `${daysOverdue} days overdue`
        } else if (hoursOverdue > 0) {
          // Hours overdue
          enhanced.countdown = `Overdue by ${hoursOverdue}h ${minutesOverdue}m`
        } else {
          // Minutes overdue
          enhanced.countdown = `Overdue by ${minutesOverdue}m`
        }
      } else if (timeDiff < 60 * 60 * 1000) {
          // Due within 1 hour
          const minutesLeft = Math.floor(timeDiff / (1000 * 60))
          enhanced.status = 'due_now'
          enhanced.priority = 'critical'
          enhanced.countdown = `Due in ${minutesLeft}m`
        } else if (timeDiff < 3 * 60 * 60 * 1000) {
          // Due within 3 hours
          const hoursLeft = Math.floor(timeDiff / (1000 * 60 * 60))
          const minutesLeft = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60))
          enhanced.status = 'due_soon'
          enhanced.priority = 'urgent'
          enhanced.countdown = `Due in ${hoursLeft}h ${minutesLeft}m`
        } else if (daysDiff === 0) {
          // Due later today
          const timeString = dueDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
          enhanced.status = 'due_today'
          enhanced.priority = 'urgent'
          enhanced.countdown = `Due today at ${timeString}`

          // Debug problematic reminders
          if (reminder.title && (reminder.title.includes('MAJOR') || reminder.title.includes('OPERATION RESEARCH') || reminder.title.includes('COMPUTER'))) {
            console.log(`  Final countdown: "${enhanced.countdown}"`)
            console.log(`  Time string: "${timeString}"`)
          }
        } else if (daysDiff === 1) {
          enhanced.status = 'due_tomorrow'
          enhanced.priority = 'high'
          enhanced.countdown = 'Due tomorrow'
        } else if (daysDiff <= 7) {
          enhanced.status = 'upcoming'
          enhanced.priority = 'medium'
          enhanced.countdown = `${daysDiff} days left`
        } else {
          enhanced.status = 'upcoming'
          enhanced.priority = 'low'
          enhanced.countdown = `${daysDiff} days left`
        }
    } else {
      enhanced.status = 'no_date'
      enhanced.priority = 'low'
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
          lab: "🧪",
        }

        // Priority class for enhanced visual feedback
        const priorityClass = reminder.priority ? `priority-${reminder.priority}` : ''

        // Status icons for different countdown states
        const statusIcons = {
          'overdue': '🚨',
          'overdue_today': '🚨',
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

          // Check for parsed time first, then fall back to due_date time
          let timeToUse = null

          // First check if we have a parsed time for this reminder
          const parsedTime = getOrParseTime(reminder)
          if (parsedTime) {
            timeToUse = parsedTime
            console.log(`Using parsed time for edit: ${parsedTime}`)
          } else {
            // Fall back to extracting time from due_date
            const hours = date.getHours().toString().padStart(2, '0')
            const minutes = date.getMinutes().toString().padStart(2, '0')
            timeToUse = `${hours}:${minutes}`
            console.log(`Using due_date time for edit: ${timeToUse}`)
          }

          setTimeFields('editReminder', timeToUse)
        } else {
          setTimeFields('editReminder', '')
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

    // Update hidden time field before getting its value
    updateHiddenTimeField('editReminder')
    const dueTime = document.getElementById("editReminderTime").value

    if (!title) {
      showNotification("Please enter a title for the reminder", "error")
      return
    }

    // Combine date and time if both are provided
    let dueDateTimeISO = null
    if (dueDate) {
      let dateTime = new Date(dueDate)

      if (dueTime) {
        // Parse time and set it on the date
        const [hours, minutes] = dueTime.split(':')
        dateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
      } else {
        // Set default time based on reminder type
        if (type === 'assignment' || type === 'project') {
          dateTime.setHours(23, 59, 0, 0) // 11:59 PM for assignments/projects
        } else if (type === 'exam') {
          dateTime.setHours(9, 0, 0, 0) // 9:00 AM for exams
        } else if (type === 'lab') {
          dateTime.setHours(14, 0, 0, 0) // 2:00 PM for labs
        } else {
          dateTime.setHours(23, 59, 0, 0) // Default to end of day
        }
      }

      dueDateTimeISO = dateTime.toISOString()
    }

    const reminderData = {
      title: title,
      description: description,
      type: type,
      due_date: dueDateTimeISO,
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

// Exam Countdown Functions - Firebase Only
function loadExamCountdown() {
  console.log('🔄 Loading exam countdown from Firebase...')

  fetch('/api/next-exam')
    .then(response => {
      console.log('📡 Next exam API response status:', response.status)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      return response.json()
    })
    .then(data => {
      console.log('📊 Next exam data received:', data)
      if (data.next_exam) {
        displayExamCountdown(data.next_exam)
      } else {
        console.log('❌ No upcoming exams found')
        hideExamCountdown()
      }
    })
    .catch(error => {
      console.error('❌ Error loading exam countdown from Firebase:', error)
      hideExamCountdown()
    })
}

// Firebase-only countdown - no localStorage needed

// Display exam countdown
function displayExamCountdown(exam) {
  const countdownElement = document.getElementById('examCountdown')
  const subjectElement = document.getElementById('countdownSubject')
  const timerElement = document.getElementById('countdownTimer')

  if (!countdownElement || !subjectElement || !timerElement) return

  subjectElement.textContent = exam.subject

  // Format countdown text
  let countdownText = ''
  if (exam.days_left > 0) {
    countdownText = `${exam.days_left}d ${exam.hours_left}h ${exam.minutes_left}m`
  } else if (exam.hours_left > 0) {
    countdownText = `${exam.hours_left}h ${exam.minutes_left}m`
  } else {
    countdownText = `${exam.minutes_left}m`
  }
  timerElement.textContent = countdownText

  // Apply dynamic colors based on time remaining
  applyExamCountdownColor(countdownElement, exam.days_left, exam.hours_left, exam.minutes_left)

  countdownElement.style.display = 'block'
}

// Hide exam countdown
function hideExamCountdown() {
  const countdownElement = document.getElementById('examCountdown')
  if (countdownElement) {
    countdownElement.style.display = 'none'
  }
}

// Fresh color application function
function applyExamCountdownColor(element, daysLeft, hoursLeft, minutesLeft) {
  // Remove any existing color classes and reset all background properties
  element.classList.remove('countdown-days', 'countdown-hours', 'countdown-minutes')
  element.style.background = 'none'
  element.style.backgroundImage = 'none'
  element.style.backgroundGradient = 'none'

  // Determine color based on time remaining
  if (daysLeft > 0) {
    // Green for days remaining
    element.classList.add('countdown-days')
    element.style.setProperty('background-color', '#28a745', 'important')
    element.style.setProperty('background', '#28a745', 'important')
    element.style.setProperty('color', 'white', 'important')
    element.style.setProperty('border-left', '5px solid #1e7e34', 'important')
  } else if (hoursLeft > 0) {
    // Yellow for hours remaining
    element.classList.add('countdown-hours')
    element.style.setProperty('background-color', '#ffc107', 'important')
    element.style.setProperty('background', '#ffc107', 'important')
    element.style.setProperty('color', '#212529', 'important')
    element.style.setProperty('border-left', '5px solid #e0a800', 'important')
  } else {
    // Red for minutes remaining
    element.classList.add('countdown-minutes')
    element.style.setProperty('background-color', '#dc3545', 'important')
    element.style.setProperty('background', '#dc3545', 'important')
    element.style.setProperty('color', 'white', 'important')
    element.style.setProperty('border-left', '5px solid #c82333', 'important')
  }

  console.log(`🎨 Applied color: ${daysLeft}d ${hoursLeft}h ${minutesLeft}m -> ${element.style.backgroundColor}`)
}

// Timetable Functions
function showTimetable() {
  // This function is called by switchTab, so it just needs to load data
  loadTimetable()
  loadExamTimetable()

  // Initialize with normal timetable by default
  currentTimetableType = 'normal'
  updateTimetableToggleButtons()

  // Show normal timetable initially
  setTimeout(() => {
    displaySchedule()
  }, 500)

  // Check for upcoming exams and prioritize exam timetable
  setTimeout(() => {
    checkExamPriority()
  }, 1500)
}

function updateTimetableToggleButtons() {
  const normalBtn = document.getElementById('normalTimetableBtn')
  const examBtn = document.getElementById('examTimetableBtn')

  if (normalBtn && examBtn) {
    normalBtn.classList.toggle('active', currentTimetableType === 'normal')
    examBtn.classList.toggle('active', currentTimetableType === 'exam')
  }
}

function checkExamPriority() {
  if (!currentExamTimetable.exams || currentExamTimetable.exams.length === 0) {
    return
  }

  const now = new Date()
  const upcomingExams = currentExamTimetable.exams.filter(exam => {
    const examDate = new Date(exam.date)
    return examDate >= now
  })

  // If there are upcoming exams, prioritize exam timetable
  if (upcomingExams.length > 0) {
    switchTimetableType('exam')
  }
}

function switchTimetableType(type) {
  console.log('switchTimetableType called with type:', type)
  currentTimetableType = type

  // Update button states
  updateTimetableToggleButtons()

  // Update add button text and functionality
  const addBtn = document.getElementById('addTimetableBtn')
  if (addBtn) {
    if (type === 'exam') {
      addBtn.setAttribute('onclick', 'openExamModal()')
      addBtn.innerHTML = '<i class="fas fa-plus"></i>'
      addBtn.title = 'Add Exam'
    } else {
      addBtn.setAttribute('onclick', 'openAddModal()')
      addBtn.innerHTML = '<i class="fas fa-plus"></i>'
      addBtn.title = 'Add Class'
    }
  }



  // Load appropriate timetable
  if (type === 'exam') {
    console.log('Switching to exam mode, loading exam timetable first')
    loadExamTimetable()
  } else {
    console.log('Switching to normal mode')
    displaySchedule()
  }
}

// Day navigation functions
function changeDay(direction) {
  currentDayIndex += direction
  if (currentDayIndex < 0) currentDayIndex = 6
  if (currentDayIndex > 6) currentDayIndex = 0

  updateDayDisplay()

  // Display appropriate schedule based on current type
  if (currentTimetableType === 'exam') {
    displayExamSchedule()
  } else {
    displaySchedule()
  }
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
    // Only display if we're in normal mode
    if (currentTimetableType === 'normal') {
      displaySchedule()
    }
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
      // Only display if we're in normal mode
      if (currentTimetableType === 'normal') {
        displaySchedule()
      }
    })
    .catch((error) => {
      console.error("Error loading timetable:", error)

      // Try to load from LocalStorage as fallback
      const cachedTimetable = restoreTimetableFromLocalStorage()
      if (cachedTimetable) {
        console.log("Loading timetable from LocalStorage fallback")
        currentTimetable = cachedTimetable.timetable || {}
        // Only display if we're in normal mode
        if (currentTimetableType === 'normal') {
          displaySchedule()
        }
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
  // If we're in exam mode, don't display normal schedule
  if (currentTimetableType === 'exam') {
    displayExamSchedule()
    return
  }

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
    // Only display normal schedule if we're in normal mode
    if (currentTimetableType === 'normal') {
      displaySchedule()
    }
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
  // Only display normal schedule if we're in normal mode
  if (currentTimetableType === 'normal') {
    displaySchedule()
  }
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

// Exam Timetable Functions
function loadExamTimetable() {
  console.log("Loading exam timetable from /api/exam-timetable (GET)...")

  fetch("/api/exam-timetable")
    .then((response) => {
      console.log("Response from /api/exam-timetable (GET):", response.status)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      return response.json()
    })
    .then((data) => {
      console.log("Data from /api/exam-timetable (GET):", data)
      currentExamTimetable = data.exam_timetable || { exams: [] }
      if (currentTimetableType === 'exam') {
        displayExamSchedule()
      }
      // Refresh countdown after loading
      loadExamCountdown()
    })
    .catch((error) => {
      console.error("Error loading exam timetable:", error)
      currentExamTimetable = { exams: [] }

      if (currentTimetableType === 'exam') {
        displayExamSchedule()
      }
      // Refresh countdown after loading
      loadExamCountdown()
    })
}

function displayExamSchedule() {
  console.log('displayExamSchedule called')
  const container = document.getElementById("scheduleContainer")
  if (!container) {
    console.log('Container not found')
    return
  }

  const exams = currentExamTimetable.exams || []
  console.log('Current exam timetable:', currentExamTimetable)
  console.log('Exams array:', exams)
  console.log('Number of exams:', exams.length)

  if (exams.length === 0) {
    console.log('No exams found, showing empty state')
    container.innerHTML = `
      <div class="empty-schedule">
        <i class="fas fa-graduation-cap empty-icon"></i>
        <p>No exams scheduled</p>
        <button class="btn btn-primary" onclick="openExamModal()" type="button">
          <i class="fas fa-plus"></i> Add Exam
        </button>
      </div>
    `
    return
  }

  // Sort exams by date
  const sortedExams = exams.sort((a, b) => new Date(a.date) - new Date(b.date))

  let html = '<div class="exam-schedule-list">'

  sortedExams.forEach((exam, index) => {
    // Combine date and time for accurate countdown
    const examDate = new Date(exam.date)

    // Parse the time (e.g., "09:30") and add it to the date
    if (exam.time) {
      const [hours, minutes] = exam.time.split(':').map(Number)
      examDate.setHours(hours, minutes, 0, 0)
    }

    const now = new Date()
    const isUpcoming = examDate >= now
    const isPast = examDate < now

    // Calculate countdown
    let countdownText = ''
    if (isUpcoming) {
      const timeDiff = examDate - now
      const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60))

      if (days > 0) {
        countdownText = `${days}d ${hours}h left`
      } else if (hours > 0) {
        countdownText = `${hours}h ${minutes}m left`
      } else if (minutes > 0) {
        countdownText = `${minutes}m left`
      } else {
        countdownText = 'Starting now!'
      }
    }

    html += `
      <div class="exam-item ${isPast ? 'past-exam' : isUpcoming ? 'upcoming-exam' : ''}">
        <div class="exam-header">
          <div class="exam-subject">${exam.subject}</div>
          <div class="exam-actions">
            <button class="edit-btn" onclick="editExam(${index})" type="button" title="Edit Exam">
              <i class="fas fa-edit"></i>
            </button>
            <button class="delete-btn" onclick="deleteExam(${index})" type="button" title="Delete Exam">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="exam-details">
          <div class="exam-date">
            <i class="fas fa-calendar"></i> ${examDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </div>
          <div class="exam-time">
            <i class="fas fa-clock"></i> ${exam.time} (${exam.session})
          </div>
          ${exam.location ? `<div class="exam-location"><i class="fas fa-map-marker-alt"></i> ${exam.location}</div>` : ''}
          ${countdownText ? `<div class="exam-countdown ${isPast ? 'past' : 'upcoming'}">${countdownText}</div>` : ''}
        </div>
      </div>
    `
  })

  html += '</div>'
  container.innerHTML = html
}

function saveExamTimetable() {
  console.log('💾 Saving exam timetable to Firebase...')

  console.log("Fetching /api/exam-timetable (POST) to save exam timetable...")
  fetch("/api/exam-timetable", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      exam_timetable: currentExamTimetable,
    }),
  })
    .then((response) => {
      console.log("Response from /api/exam-timetable (POST):", response.status)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      return response.json()
    })
    .then((data) => {
      console.log("Data from /api/exam-timetable (POST):", data)
      if (data.error) {
        showNotification(data.error, "error")
      } else {
        showNotification("Exam timetable saved successfully!", "success")
        // Refresh countdown after saving
        loadExamCountdown()
      }
    })
    .catch((error) => {
      console.error("Error saving exam timetable:", error)
      // Still show success since localStorage save worked
      showNotification("Exam timetable saved locally!", "success")
      // Refresh countdown after saving
      loadExamCountdown()
    })
}

// Exam Modal Functions
function openExamModal() {
  editingExamIndex = -1
  document.getElementById('examModalTitle').textContent = 'Add New Exam'
  document.getElementById('examForm').reset()
  document.getElementById('examModal').style.display = 'flex'
}

function closeExamModal() {
  document.getElementById('examModal').style.display = 'none'
  editingExamIndex = -1
}

function editExam(index) {
  const exam = currentExamTimetable.exams[index]
  if (!exam) return

  editingExamIndex = index
  document.getElementById('examModalTitle').textContent = 'Edit Exam'

  // Fill form with exam data
  document.getElementById('examSubject').value = exam.subject
  document.getElementById('examDate').value = exam.date
  document.getElementById('examDay').value = exam.day
  document.getElementById('examTime').value = exam.time
  document.getElementById('examSession').value = exam.session
  document.getElementById('examLocation').value = exam.location || ''

  document.getElementById('examModal').style.display = 'flex'
}

function deleteExam(index) {
  const exam = currentExamTimetable.exams[index]
  if (!exam) return

  const examInfo = `${exam.subject} on ${new Date(exam.date).toLocaleDateString()}`
  if (confirm(`Are you sure you want to delete the exam:\n${examInfo}?`)) {
    currentExamTimetable.exams.splice(index, 1)
    saveExamTimetable()
    displayExamSchedule()
    showNotification("Exam deleted successfully", "success")
  }
}

// Handle exam form submission and date change
document.addEventListener('DOMContentLoaded', function() {
  const examForm = document.getElementById('examForm')
  if (examForm) {
    examForm.addEventListener('submit', function(e) {
      e.preventDefault()
      saveExam()
    })
  }

  // Auto-fill day when date is selected
  const examDateInput = document.getElementById('examDate')
  if (examDateInput) {
    examDateInput.addEventListener('change', function() {
      const selectedDate = new Date(this.value)
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      const dayName = dayNames[selectedDate.getDay()]
      document.getElementById('examDay').value = dayName
    })
  }
})

function saveExam() {
  const formData = {
    subject: document.getElementById('examSubject').value,
    date: document.getElementById('examDate').value,
    day: document.getElementById('examDay').value,
    time: document.getElementById('examTime').value,
    session: document.getElementById('examSession').value,
    location: document.getElementById('examLocation').value
  }

  // Validate required fields
  if (!formData.subject || !formData.date || !formData.day || !formData.time || !formData.session) {
    showNotification("Please fill in all required fields", "error")
    return
  }

  // Validate date is not in the past
  const examDate = new Date(formData.date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (examDate < today) {
    showNotification("Exam date cannot be in the past", "error")
    return
  }

  if (!currentExamTimetable.exams) {
    currentExamTimetable.exams = []
  }

  if (editingExamIndex >= 0) {
    // Edit existing exam
    currentExamTimetable.exams[editingExamIndex] = formData
    showNotification("Exam updated successfully", "success")
  } else {
    // Add new exam
    currentExamTimetable.exams.push(formData)
    showNotification("Exam added successfully", "success")
  }

  saveExamTimetable()
  displayExamSchedule()
  closeExamModal()
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

function updateCGPAScale() {
  try {
    const scale = document.getElementById("cgpaScale")?.value || "10"
    const scaleInfo = document.getElementById("scaleInfo")
    const sgpaInputs = document.querySelectorAll(".sgpa-input")

    // Update scale info text
    let infoText = ""
    let maxValue = "10"

    switch(scale) {
      case "10":
        infoText = "Range: 0.0 - 10.0 | Excellent: 9.0+, Good: 7.0-8.9, Average: 6.0-6.9"
        maxValue = "10"
        break
      case "5":
        infoText = "Range: 1.0 - 5.0 | Excellent: 1.0-1.5, Good: 1.6-2.5, Average: 2.6-3.5 (Lower is better)"
        maxValue = "5"
        break
      case "4":
        infoText = "Range: 0.0 - 4.0 | Excellent: 3.7+, Good: 3.0-3.6, Average: 2.0-2.9"
        maxValue = "4"
        break
    }

    if (scaleInfo) {
      scaleInfo.innerHTML = `<small>${infoText}</small>`
    }

    // Update all SGPA input max values
    sgpaInputs.forEach(input => {
      input.setAttribute('max', maxValue)
      input.setAttribute('placeholder', `e.g., ${scale === '5' ? '1.5' : scale === '4' ? '3.5' : '8.5'}`)
    })

    console.log(`Updated CGPA scale to ${scale}-point system`)
  } catch (error) {
    console.error("Error updating CGPA scale:", error)
  }
}

function calculateCGPA() {
  try {
    const scale = document.getElementById("cgpaScale")?.value || "10"
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
      body: JSON.stringify({ semesters, scale: Number.parseFloat(scale) }),
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

// Calendar Variables
let currentDate = new Date()
let calendarData = {
  events: [],
  holidays: []
}
let selectedDate = null
let currentCalendarMode = 'calendar' // 'calendar' or 'holidays'

// Calendar Functions
function loadCalendar() {
  try {
    console.log("Loading calendar data...")
    console.log("Current date:", currentDate)
    console.log("Calendar data:", calendarData)

    // Initialize calendar mode (default to calendar mode)
    switchCalendarMode('calendar')
  } catch (error) {
    console.error("Error in loadCalendar:", error)
  }
}

function loadCalendarEvents() {
  // Load events from API
  return fetch('/api/calendar/events')
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      return response.json()
    })
    .then(events => {
      calendarData.events = events || []
      console.log("Loaded events:", calendarData.events)
    })
    .catch(error => {
      console.error("Error loading events:", error)
      calendarData.events = []
    })
}

function loadCalendarHolidays() {
  const year = currentDate.getFullYear()
  return fetch(`/api/holidays?year=${year}`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      return response.json()
    })
    .then(holidays => {
      calendarData.holidays = holidays || []
      console.log("Loaded holidays:", calendarData.holidays)
    })
}

function renderCalendar() {
  try {
    updateMonthYearDisplay()
    generateCalendarGrid()
  } catch (error) {
    console.error("Error rendering calendar:", error)
  }
}

function updateMonthYearDisplay() {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  const monthYearElement = document.getElementById('currentMonthYear')
  if (monthYearElement) {
    monthYearElement.textContent = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`
  }
}

function generateCalendarGrid() {
  const grid = document.getElementById('calendarGrid')
  if (!grid) {
    console.error('Calendar grid element not found!')
    return
  }

  console.log('Generating calendar grid...', 'Current date:', currentDate)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Get first day of month and number of days
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()

  // Get previous month's last days
  const prevMonth = new Date(year, month, 0)
  const daysInPrevMonth = prevMonth.getDate()

  let html = ''
  let dayCount = 1
  let nextMonthDay = 1

  // Calculate minimum weeks needed
  const totalCells = startingDayOfWeek + daysInMonth
  const weeksNeeded = Math.ceil(totalCells / 7)

  // Generate only the necessary weeks (usually 5, sometimes 6)
  for (let week = 0; week < weeksNeeded; week++) {
    for (let day = 0; day < 7; day++) {
      const cellIndex = week * 7 + day
      let dateNumber, isCurrentMonth, fullDate

      if (cellIndex < startingDayOfWeek) {
        // Previous month days
        dateNumber = daysInPrevMonth - startingDayOfWeek + cellIndex + 1
        isCurrentMonth = false
        fullDate = new Date(year, month - 1, dateNumber)
      } else if (dayCount <= daysInMonth) {
        // Current month days
        dateNumber = dayCount
        isCurrentMonth = true
        fullDate = new Date(year, month, dateNumber)
        dayCount++
      } else {
        // Next month days (only show a few to complete the week)
        dateNumber = nextMonthDay
        isCurrentMonth = false
        fullDate = new Date(year, month + 1, dateNumber)
        nextMonthDay++
      }

      const dateStr = fullDate.toISOString().split('T')[0]
      const isToday = isDateToday(fullDate)
      const dayEvents = getEventsForDate(dateStr)

      let cssClasses = ['calendar-date']
      if (!isCurrentMonth) cssClasses.push('other-month')
      if (isToday) cssClasses.push('today')
      if (dayEvents.length > 0) cssClasses.push('has-events')

      // Create event indicator with color
      let eventIndicator = ''
      if (dayEvents.length > 0) {
        const primaryEventColor = dayEvents[0].color || 'blue'
        eventIndicator = `<div class="event-indicator event-indicator-${primaryEventColor}">${dayEvents.length}</div>`
      }

      html += `
        <div class="${cssClasses.join(' ')}" onclick="selectDate('${dateStr}')" data-date="${dateStr}">
          <div class="date-number">${dateNumber}</div>
          ${eventIndicator}
        </div>
      `
    }
  }

  grid.innerHTML = html
  console.log(`Calendar grid generated with ${html.split('<div class="calendar-date"').length - 1} date cells`)
}

// Helper Functions
function isDateToday(date) {
  const today = new Date()
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear()
}

// Event and holiday functions
function getEventsForDate(dateStr) {
  return calendarData.events.filter(event => event.date === dateStr)
}

function getHolidaysForDate(dateStr) {
  return calendarData.holidays.filter(holiday => holiday.date === dateStr)
}

// Navigation Functions
function previousMonth() {
  currentDate.setMonth(currentDate.getMonth() - 1)
  loadCalendarHolidays().then(() => renderCalendar())
}

function nextMonth() {
  currentDate.setMonth(currentDate.getMonth() + 1)
  loadCalendarHolidays().then(() => renderCalendar())
}

function goToToday() {
  currentDate = new Date()
  loadCalendarHolidays().then(() => renderCalendar())
}

// Date Selection
function selectDate(dateStr) {
  selectedDate = dateStr
  showEventDetailsPanel(dateStr)
}

function showEventDetailsPanel(dateStr) {
  const panel = document.getElementById('eventDetailsPanel')
  const titleElement = document.getElementById('selectedDateTitle')
  const eventsListElement = document.getElementById('eventsList')

  if (!panel || !titleElement || !eventsListElement) return

  const date = new Date(dateStr + 'T00:00:00')
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  titleElement.textContent = `Events for ${formattedDate}`

  const dayEvents = getEventsForDate(dateStr)
  let eventsHtml = ''

  if (dayEvents.length > 0) {
    dayEvents.forEach(event => {
      const eventColor = event.color || 'blue'
      eventsHtml += `
        <div class="event-item event-color-${eventColor}">
          <div class="event-header">
            <div class="event-title">📅 ${event.title}</div>
            <div class="event-actions">
              <button onclick="editEvent('${event.id}')" class="btn-icon edit-btn" title="Edit Event">
                <i class="fas fa-edit"></i>
              </button>
              <button onclick="deleteEvent('${event.id}')" class="btn-icon delete-btn" title="Delete Event">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
          ${event.time ? `<div class="event-time">⏰ ${event.time}</div>` : ''}
          ${event.description ? `<div class="event-description">${event.description}</div>` : ''}
          <div class="event-type event-type-${eventColor}">${event.type}</div>
        </div>
      `
    })
  } else {
    eventsHtml = `
      <div class="empty-state" style="padding: 20px; text-align: center;">
        <i class="fas fa-calendar-plus empty-icon"></i>
        <p>No events for this date</p>
      </div>
    `
  }

  eventsListElement.innerHTML = eventsHtml
  panel.style.display = 'block'

  // Scroll to panel
  panel.scrollIntoView({ behavior: 'smooth' })
}

function closeEventPanel() {
  const panel = document.getElementById('eventDetailsPanel')
  if (panel) {
    panel.style.display = 'none'
  }
  selectedDate = null
}

// Event panel functions removed

// Mode Switching Functions
function switchCalendarMode(mode) {
  currentCalendarMode = mode

  // Update button states
  document.getElementById('calendarModeBtn').classList.toggle('active', mode === 'calendar')
  document.getElementById('holidaysModeBtn').classList.toggle('active', mode === 'holidays')

  // Show/hide content
  document.getElementById('calendarMode').style.display = mode === 'calendar' ? 'block' : 'none'
  document.getElementById('holidaysMode').style.display = mode === 'holidays' ? 'block' : 'none'

  // Load appropriate data
  if (mode === 'calendar') {
    // Load events and holidays for calendar mode
    Promise.all([loadCalendarEvents(), loadCalendarHolidays()]).then(() => {
      renderCalendar()
    }).catch(error => {
      console.error("Error loading calendar data:", error)
      showNotification("Error loading calendar data", "error")
    })
  } else if (mode === 'holidays') {
    loadHolidaysList()
  }
}

// Holidays List Functions
function loadHolidaysList() {
  try {
    console.log("Loading holidays list...")
    const container = document.getElementById("holidaysContainer")

    if (!container) {
      console.error("Holidays container not found")
      return
    }

    // Get filter values
    const year = document.getElementById("holidayYear")?.value || new Date().getFullYear()
    const type = document.getElementById("holidayType")?.value || ""

    container.innerHTML = `
            <div class="loading-state">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading holidays for ${year}...</p>
            </div>
        `

    // Build query parameters
    const params = new URLSearchParams()
    if (year) params.append('year', year)
    if (type) params.append('type', type)

    fetch(`/api/holidays?${params.toString()}`)
      .then((response) => {
        console.log("Response from /api/holidays (GET):", response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((holidays) => {
        console.log("Data from /api/holidays (GET):", holidays)
        displayHolidaysList(holidays)
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
    console.error("Error in loadHolidaysList:", error)
  }
}

function displayHolidaysList(holidays) {
  try {
    const container = document.getElementById("holidaysContainer")
    if (!container) return

    if (!holidays || holidays.length === 0) {
      container.innerHTML = `
              <div class="empty-state">
                  <i class="fas fa-star empty-icon"></i>
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
                      <div class="holiday-name">🎉 ${holiday.name}</div>
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

function displayCalendar(calendarData) {
  try {
    const container = document.getElementById("calendarContainer")
    if (!container) return

    if (!calendarData || calendarData.length === 0) {
      container.innerHTML = `
              <div class="empty-state">
                  <i class="fas fa-calendar empty-icon"></i>
                  <p>No events or holidays found</p>
                  <button onclick="openAddEventModal()" class="btn btn-primary" style="margin-top: 16px;">
                      <i class="fas fa-plus"></i> Add Your First Event
                  </button>
              </div>
          `
      return
    }

    const calendarHTML = calendarData
      .map((item) => {
        const isEvent = item.type === 'event'
        const cardClass = isEvent ? 'event-card' : 'holiday-card'
        const typeClass = isEvent ? item.event_type || 'personal' : item.type

        return `
                  <div class="${cardClass} ${item.status || ""} ${typeClass}">
                      <div class="calendar-item-header">
                          <div class="calendar-date">${new Date(item.date).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}</div>
                          <div class="calendar-type ${typeClass}">
                              ${isEvent ? '📅' : '🎉'} ${typeClass}
                          </div>
                          ${isEvent ? `
                              <div class="event-actions">
                                  <button onclick="editEvent('${item.id}')" class="action-btn edit" title="Edit Event">
                                      <i class="fas fa-edit"></i>
                                  </button>
                                  <button onclick="deleteEvent('${item.id}')" class="action-btn delete" title="Delete Event">
                                      <i class="fas fa-trash"></i>
                                  </button>
                              </div>
                          ` : ''}
                      </div>
                      <div class="calendar-item-title">${item.name || item.title}</div>
                      <div class="calendar-item-description">${item.description}</div>
                      ${item.time ? `<div class="calendar-item-time"><i class="fas fa-clock"></i> ${item.time}</div>` : ''}
                      ${
                        item.countdown
                          ? `<div class="calendar-countdown ${item.status}">${item.countdown}</div>`
                          : ""
                      }
                  </div>
              `
      })
      .join("")

    container.innerHTML = calendarHTML
  } catch (error) {
    console.error("Error displaying calendar:", error)
  }
}

// Event Management Functions - Removed

// Event save functions removed

// saveEvent function removed

// Event test functions removed

// Event Management Functions
function openAddEventModal() {
  const modal = document.getElementById('addEventModal')
  const form = document.getElementById('addEventForm')

  // Reset form and remove any edit data
  form.reset()
  form.removeAttribute('data-event-id')

  // Set default date to today or selected date
  const today = new Date().toISOString().split('T')[0]
  document.getElementById('eventDate').value = selectedDate || today

  // Set default values
  document.getElementById('eventType').value = 'personal'
  document.getElementById('eventColor').value = 'blue'

  // Reset modal title and button text
  document.getElementById('addEventModalLabel').textContent = '📅 Add Calendar Event'
  document.querySelector('#addEventModal .btn-primary').innerHTML = '<i class="fas fa-save"></i> Save Event'

  // Show modal
  modal.style.display = 'flex'
}

function closeAddEventModal() {
  const modal = document.getElementById('addEventModal')
  modal.style.display = 'none'
}

function saveEvent() {
  const form = document.getElementById('addEventForm')
  const eventId = form.getAttribute('data-event-id')
  const isEditing = !!eventId

  const title = document.getElementById('eventTitle').value.trim()
  const date = document.getElementById('eventDate').value
  const time = document.getElementById('eventTime').value
  const type = document.getElementById('eventType').value
  const description = document.getElementById('eventDescription').value.trim()
  const color = document.getElementById('eventColor').value

  // Validation
  if (!title) {
    alert('Please enter an event title')
    return
  }

  if (!date) {
    alert('Please select a date')
    return
  }

  // Create event data
  const eventData = {
    title,
    date,
    time: time || null,
    type,
    description: description || null,
    color
  }

  // Determine URL and method
  const url = isEditing ? `/api/calendar/events/${eventId}` : '/api/calendar/events'
  const method = isEditing ? 'PUT' : 'POST'

  // Save to API
  fetch(url, {
    method: method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventData)
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
  })
  .then(data => {
    console.log('Event saved:', data)
    showNotification(isEditing ? 'Event updated successfully!' : 'Event added successfully!', 'success')

    // Reset form and modal
    form.removeAttribute('data-event-id')
    document.getElementById('addEventModalLabel').textContent = '📅 Add Calendar Event'
    document.querySelector('#addEventModal .btn-primary').innerHTML = '<i class="fas fa-save"></i> Save Event'

    // Close modal
    closeAddEventModal()

    // Reload calendar
    loadCalendarEvents().then(() => {
      renderCalendar()
      // If event panel is open for this date, refresh it
      if (selectedDate === date) {
        showEventDetailsPanel(date)
      }
    })
  })
  .catch(error => {
    console.error('Error saving event:', error)
    showNotification('Error saving event. Please try again.', 'error')
  })
}

function editEvent(eventId) {
  // Find the event
  const event = calendarData.events.find(e => e.id === eventId)
  if (!event) {
    showNotification('Event not found', 'error')
    return
  }

  // Populate the form with event data
  document.getElementById('eventTitle').value = event.title
  document.getElementById('eventDate').value = event.date
  document.getElementById('eventTime').value = event.time || ''
  document.getElementById('eventType').value = event.type || 'personal'
  document.getElementById('eventDescription').value = event.description || ''
  document.getElementById('eventColor').value = event.color || 'blue'

  // Store the event ID for updating
  document.getElementById('addEventForm').setAttribute('data-event-id', eventId)

  // Change modal title and button text
  document.getElementById('addEventModalLabel').textContent = '✏️ Edit Event'
  document.querySelector('#addEventModal .btn-primary').innerHTML = '<i class="fas fa-save"></i> Update Event'

  // Show modal
  const modal = document.getElementById('addEventModal')
  modal.style.display = 'flex'
}

function deleteEvent(eventId) {
  if (!confirm('Are you sure you want to delete this event?')) {
    return
  }

  fetch(`/api/calendar/events/${eventId}`, {
    method: 'DELETE'
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
  })
  .then(data => {
    console.log('Event deleted:', data)
    showNotification('Event deleted successfully!', 'success')

    // Reload calendar data and re-render
    loadCalendarEvents().then(() => {
      renderCalendar()
      // If event panel is open, refresh it
      if (selectedDate) {
        showEventDetailsPanel(selectedDate)
      }
    })
  })
  .catch(error => {
    console.error('Error deleting event:', error)
    showNotification('Error deleting event. Please try again.', 'error')
  })
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
                          <div class="history-card cgpa clickable" onclick="openCGPAAnalysis('${record.timestamp}')">
                              <div class="history-header">
                                  <div class="history-date">${new Date(record.timestamp).toLocaleDateString()}</div>
                                  <button class="delete-history-btn" onclick="event.stopPropagation(); deleteCGPARecord('${record.timestamp}')" title="Delete this record">
                                      <i class="fas fa-trash"></i>
                                  </button>
                              </div>
                              <div class="history-value cgpa">${result.cgpa}</div>
                              <div class="history-details">
                                  CGPA: ${result.cgpa}/${result.scale || 10}.0<br>
                                  Total Credits: ${result.total_credits}<br>
                                  4.0 Scale: ${result.gpa_4_scale || 'N/A'}
                              </div>
                              <div class="click-hint">
                                  <i class="fas fa-chart-line"></i> Click for detailed analysis
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
                                  <button class="delete-history-btn" onclick="deleteAttendanceRecord('${record.timestamp}')" title="Delete this record">
                                      <i class="fas fa-trash"></i>
                                  </button>
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

// Delete CGPA record function
function deleteCGPARecord(timestamp) {
  try {
    if (confirm("Are you sure you want to delete this CGPA calculation?")) {
      console.log("Deleting CGPA record with timestamp:", timestamp)

      fetch('/api/delete_cgpa_record', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timestamp: timestamp })
      })
        .then(response => {
          console.log("Response from /api/delete_cgpa_record (DELETE):", response.status)
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }
          return response.json()
        })
        .then(data => {
          console.log("Data from /api/delete_cgpa_record (DELETE):", data)
          if (data.error) {
            showNotification(data.error, "error")
          } else {
            showNotification("CGPA record deleted successfully!", "success")
            loadHistory() // Reload the history to reflect changes
          }
        })
        .catch(error => {
          console.error("Error deleting CGPA record:", error)
          showNotification("Error deleting CGPA record. Please try again.", "error")
        })
    }
  } catch (error) {
    console.error("Error in deleteCGPARecord:", error)
    showNotification("Error deleting CGPA record", "error")
  }
}

// Delete attendance record function
function deleteAttendanceRecord(timestamp) {
  try {
    if (confirm("Are you sure you want to delete this attendance record?")) {
      console.log("Deleting attendance record with timestamp:", timestamp)

      fetch('/api/delete_attendance_record', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timestamp: timestamp })
      })
        .then(response => {
          console.log("Response from /api/delete_attendance_record (DELETE):", response.status)
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }
          return response.json()
        })
        .then(data => {
          console.log("Data from /api/delete_attendance_record (DELETE):", data)
          if (data.error) {
            showNotification(data.error, "error")
          } else {
            showNotification("Attendance record deleted successfully!", "success")
            loadHistory() // Reload the history to reflect changes
          }
        })
        .catch(error => {
          console.error("Error deleting attendance record:", error)
          showNotification("Error deleting attendance record. Please try again.", "error")
        })
    }
  } catch (error) {
    console.error("Error in deleteAttendanceRecord:", error)
    showNotification("Error deleting attendance record", "error")
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

// Initialize CGPA scale on page load
document.addEventListener("DOMContentLoaded", function () {
  // Initialize CGPA scale selector
  setTimeout(() => {
    updateCGPAScale()
  }, 100)

  // Add test reminders button for debugging (remove in production)
  const username = localStorage.getItem('username')
  if (username === 'hasselx') {
    const testButton = document.createElement('button')
    testButton.textContent = 'Add Test Reminders'
    testButton.onclick = createTestReminders
    testButton.style.position = 'fixed'
    testButton.style.top = '10px'
    testButton.style.right = '10px'
    testButton.style.zIndex = '9999'
    testButton.style.backgroundColor = '#ff6b6b'
    testButton.style.color = 'white'
    testButton.style.border = 'none'
    testButton.style.padding = '10px'
    testButton.style.borderRadius = '5px'
    document.body.appendChild(testButton)
  }
})

// Test function to create problematic reminders
function createTestReminders() {
  const testReminders = [
    {
      title: 'MAJOR',
      description: 'Major project online review on this sunday 11:00 am',
      type: 'project',
      due_date: '2025-07-13' // Today (Sunday)
    },
    {
      title: 'OPERATION RESEARCH',
      description: 'OPERATION RESEARCH EXAM ON THIS SUNDAY 2 PM',
      type: 'exam',
      due_date: '2025-07-13' // Today (Sunday)
    },
    {
      title: 'COMPUTER',
      description: 'COMPUTER ASSIGNMENT ON THIS SUNDAY 9 AM',
      type: 'assignment',
      due_date: '2025-07-13' // Today (Sunday)
    }
  ]

  testReminders.forEach((reminder, index) => {
    setTimeout(() => {
      // Set form values
      document.getElementById("reminderTitle").value = reminder.title
      document.getElementById("reminderDescription").value = reminder.description
      document.getElementById("reminderType").value = reminder.type
      document.getElementById("reminderDate").value = reminder.due_date

      // Save the reminder
      saveReminder()
    }, index * 1000) // Delay each reminder by 1 second
  })
}

// Modern Flip Clock Functionality
let previousDigits = { hour1: '', hour2: '', minute1: '', minute2: '', second1: '', second2: '' }

function updateModernFlipClock() {
  try {
    const now = new Date()

    // Get user's timezone
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

    // Format time in 12-hour format
    const timeString = now.toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    // Parse the time string to get individual components
    const [time, period] = timeString.split(' ')
    const [hours, minutes, seconds] = time.split(':')

    // Split each time component into individual digits
    const hour1 = hours[0]
    const hour2 = hours[1]
    const minute1 = minutes[0]
    const minute2 = minutes[1]
    const second1 = seconds[0]
    const second2 = seconds[1]

    // Update each digit with animation
    updateFlipDigit('hour1', hour1, previousDigits.hour1)
    updateFlipDigit('hour2', hour2, previousDigits.hour2)
    updateFlipDigit('minute1', minute1, previousDigits.minute1)
    updateFlipDigit('minute2', minute2, previousDigits.minute2)
    updateFlipDigit('second1', second1, previousDigits.second1)
    updateFlipDigit('second2', second2, previousDigits.second2)

    // Update AM/PM indicator
    const amPmElement = document.getElementById('amPmIndicator')
    if (amPmElement) {
      amPmElement.textContent = period
    }

    // Update timezone and date display
    const timezoneElement = document.getElementById('timezoneInfo')
    const dateElement = document.getElementById('dateInfo')

    if (timezoneElement) {
      // Get a more readable timezone name
      const timeZoneName = timeZone.split('/').pop().replace('_', ' ')
      timezoneElement.textContent = `${timeZoneName} • ${period}`
    }

    if (dateElement) {
      const dateString = now.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
      dateElement.textContent = dateString
    }

    // Store current digits for next comparison
    previousDigits = { hour1, hour2, minute1, minute2, second1, second2 }

  } catch (error) {
    console.error('Error updating modern flip clock:', error)
  }
}

function updateFlipDigit(digitId, newValue, oldValue) {
  try {
    const digit = document.getElementById(digitId)
    if (!digit) return

    const front = digit.querySelector('.flip-digit-front')
    const back = digit.querySelector('.flip-digit-back')

    if (!front || !back) return

    // Only animate if value has changed
    if (newValue !== oldValue && oldValue !== '') {
      // Set the new value on the back
      back.textContent = newValue

      // Add flipping class to trigger animation
      digit.classList.add('flipping')

      // After animation completes, update front and remove class
      setTimeout(() => {
        front.textContent = newValue
        digit.classList.remove('flipping')
      }, 300) // Half of the 0.6s transition
    } else {
      // Initial load or no change - just set the value
      front.textContent = newValue
      back.textContent = newValue
    }
  } catch (error) {
    console.error('Error updating flip digit:', error)
  }
}

// Theme Toggle Functionality
function toggleTheme() {
  try {
    const currentTheme = document.documentElement.getAttribute('data-theme')
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark'

    document.documentElement.setAttribute('data-theme', newTheme)

    // Update theme icon
    const themeIcon = document.getElementById('themeIcon')
    if (themeIcon) {
      themeIcon.className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'
    }

    // Save theme preference to localStorage
    localStorage.setItem('theme', newTheme)

    // Show notification
    showNotification(`Switched to ${newTheme} theme`, 'success')

  } catch (error) {
    console.error('Error toggling theme:', error)
  }
}

function initializeTheme() {
  try {
    // Get saved theme or default to light
    const savedTheme = localStorage.getItem('theme') || 'light'

    document.documentElement.setAttribute('data-theme', savedTheme)

    // Update theme icon
    const themeIcon = document.getElementById('themeIcon')
    if (themeIcon) {
      themeIcon.className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'
    }

  } catch (error) {
    console.error('Error initializing theme:', error)
  }
}

// Initialize app function that can be called multiple times safely
function initializeApp() {
  console.log('🚀 Initializing app...')

  // Initialize theme
  initializeTheme()

  // Start the modern flip clock
  updateModernFlipClock()

  // Update every second
  if (!window.clockInterval) {
    window.clockInterval = setInterval(updateModernFlipClock, 1000)
  }

  // Initialize exam countdown
  console.log('🚀 Initializing exam countdown...')
  loadExamCountdown()
  if (!window.examCountdownInterval) {
    window.examCountdownInterval = setInterval(loadExamCountdown, 60000) // Update every minute
  }
}

// Initialize everything when page loads
document.addEventListener('DOMContentLoaded', function() {
  console.log('🔄 DOM Content Loaded - Initializing...')
  initializeApp()
})

// Fallback initialization if DOM is already loaded
if (document.readyState === 'loading') {
  // DOM is still loading, wait for DOMContentLoaded
} else {
  // DOM is already loaded, initialize immediately
  console.log('🔄 DOM already loaded - Initializing immediately...')
  initializeApp()
}

// Filter Functions
function applyFilters() {
  try {
    const categoryFilter = document.getElementById('categoryFilter').value
    const priorityFilter = document.getElementById('priorityFilter').value

    console.log('Applying filters:', { categoryFilter, priorityFilter })

    let filteredReminders = [...allReminders]

    // Apply category filter
    if (categoryFilter !== 'all') {
      filteredReminders = filteredReminders.filter(reminder =>
        reminder.type === categoryFilter
      )
    }

    // Apply priority filter
    if (priorityFilter !== 'all') {
      filteredReminders = filteredReminders.filter(reminder => {
        // First enhance the reminder to get status using the same function as display
        const enhanced = enhanceReminderData(reminder)

        console.log(`Filter check for ${reminder.title}:`, {
          priority: enhanced.priority,
          status: enhanced.status,
          filterValue: priorityFilter
        })

        if (priorityFilter === 'critical' || priorityFilter === 'urgent') {
          return enhanced.priority === priorityFilter
        } else {
          return enhanced.status === priorityFilter
        }
      })
    }

    console.log('Filtered reminders:', filteredReminders.length, 'out of', allReminders.length)
    displayReminders(filteredReminders)

  } catch (error) {
    console.error('Error applying filters:', error)
  }
}

function clearAllFilters() {
  try {
    document.getElementById('categoryFilter').value = 'all'
    document.getElementById('priorityFilter').value = 'all'
    displayReminders(allReminders)
    console.log('Filters cleared, showing all reminders')
  } catch (error) {
    console.error('Error clearing filters:', error)
  }
}

// CGPA Analysis Functions
let currentCGPAData = null

function openCGPAAnalysis(timestamp) {
  try {
    // Find the CGPA record by timestamp
    fetch('/api/history')
      .then(response => response.json())
      .then(data => {
        const cgpaRecord = data.cgpa.find(record => record.timestamp === timestamp)
        if (!cgpaRecord) {
          showNotification('CGPA record not found', 'error')
          return
        }

        currentCGPAData = cgpaRecord.result
        currentCGPATimestamp = timestamp  // Store the timestamp for updates
        displayCGPAAnalysis(currentCGPAData)

        // Show modal
        const modal = document.getElementById('cgpaAnalysisModal')
        modal.style.display = 'flex'
      })
      .catch(error => {
        console.error('Error loading CGPA data:', error)
        showNotification('Error loading CGPA analysis', 'error')
      })
  } catch (error) {
    console.error('Error opening CGPA analysis:', error)
  }
}

function displayCGPAAnalysis(data) {
  try {
    console.log('Displaying CGPA analysis with data:', data)

    // Update summary cards
    document.getElementById('analysisCGPA').textContent = data.cgpa || '-'
    document.getElementById('analysisScale').textContent = `${data.scale || 10}.0 Scale`
    document.getElementById('analysisTotalCredits').textContent = data.total_credits || '-'
    document.getElementById('analysisSemesters').textContent = `${data.semesters?.length || 0} Semesters`

    // Calculate average SGPA
    const avgSGPA = data.semesters?.length > 0
      ? (data.semesters.reduce((sum, sem) => sum + sem.sgpa, 0) / data.semesters.length).toFixed(2)
      : '-'
    document.getElementById('analysisAvgSGPA').textContent = avgSGPA
    document.getElementById('analysisGradePoints').textContent = `${data.total_grade_points || '-'} Points`

    // Update scale conversions
    document.getElementById('analysis4Scale').textContent = data.gpa_4_scale || '-'
    document.getElementById('analysis5Scale').textContent = data.gpa_5_scale || '-'

    // Calculate percentage if not available
    let percentage = data.percentage
    if (!percentage && data.cgpa) {
      percentage = ((data.cgpa - 0.5) * 10).toFixed(1)
    }
    document.getElementById('analysisPercentage').textContent = percentage ? `${percentage}%` : '-'

    // Populate semester details table first
    populateSemesterTable(data.semesters || [])

    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
      console.error('Chart.js is not loaded')
      showChartsNotAvailable()
      return
    }

    // Create charts with delay to ensure DOM is ready
    setTimeout(() => {
      console.log('Creating charts with semester data:', data.semesters)
      createSGPACreditsChart(data.semesters || [])
      createSGPATrendChart(data.semesters || [])
    }, 200)

  } catch (error) {
    console.error('Error displaying CGPA analysis:', error)
    showNotification('Error displaying analysis data', 'error')
  }
}

function showChartsNotAvailable() {
  const creditsChartContainer = document.querySelector('#sgpaCreditsChart').parentElement
  const trendChartContainer = document.querySelector('#sgpaTrendChart').parentElement

  if (creditsChartContainer) {
    creditsChartContainer.innerHTML = `
      <h6><i class="fas fa-chart-bar"></i> SGPA vs Credits by Semester</h6>
      <div style="text-align: center; padding: 40px; color: #666; background: #f8f9fa; border-radius: 8px;">
        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 16px; color: #ffc107;"></i>
        <p>Charts are not available. Chart.js library failed to load.</p>
        <p style="font-size: 0.9rem;">Please check your internet connection and refresh the page.</p>
      </div>
    `
  }

  if (trendChartContainer) {
    trendChartContainer.innerHTML = `
      <h6><i class="fas fa-chart-line"></i> SGPA Trend Over Semesters</h6>
      <div style="text-align: center; padding: 40px; color: #666; background: #f8f9fa; border-radius: 8px;">
        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 16px; color: #ffc107;"></i>
        <p>Trend chart is not available. Chart.js library failed to load.</p>
        <p style="font-size: 0.9rem;">Please check your internet connection and refresh the page.</p>
      </div>
    `
  }
}

function createSGPACreditsChart(semesters) {
  try {
    console.log('Attempting to create SGPA Credits chart...')

    const canvas = document.getElementById('sgpaCreditsChart')
    if (!canvas) {
      console.error('SGPA Credits chart canvas not found')
      // Try to create a fallback message
      const container = document.querySelector('.chart-container')
      if (container) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">Chart could not be loaded. Canvas element not found.</p>'
      }
      return
    }

    console.log('Canvas found:', canvas)

    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
      console.error('Chart.js is not loaded')
      canvas.parentElement.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">Chart.js library not loaded.</p>'
      return
    }

    const ctx = canvas.getContext('2d')
    console.log('Canvas context:', ctx)

    // Destroy existing chart if it exists
    if (window.sgpaCreditsChart && typeof window.sgpaCreditsChart.destroy === 'function') {
      console.log('Destroying existing chart')
      window.sgpaCreditsChart.destroy()
      window.sgpaCreditsChart = null
    }

    if (!semesters || semesters.length === 0) {
      console.log('No semester data for SGPA Credits chart')
      canvas.parentElement.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No semester data available for chart.</p>'
      return
    }

    const labels = semesters.map((sem, index) => sem.semester || `Semester ${index + 1}`)
    const sgpaData = semesters.map(sem => parseFloat(sem.sgpa) || 0)
    const creditsData = semesters.map(sem => parseFloat(sem.credits) || 0)

    console.log('Chart data prepared:', { labels, sgpaData, creditsData })

    // Set canvas size
    canvas.width = 400
    canvas.height = 200

    try {
      window.sgpaCreditsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'SGPA',
            data: sgpaData,
            backgroundColor: 'rgba(108, 92, 231, 0.8)',
            borderColor: 'rgba(108, 92, 231, 1)',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Credits',
            data: creditsData,
            backgroundColor: 'rgba(0, 184, 148, 0.8)',
            borderColor: 'rgba(0, 184, 148, 1)',
            borderWidth: 1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
          }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: {
              display: true,
              text: 'SGPA'
            },
            min: 0,
            max: 10
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: {
              display: true,
              text: 'Credits'
            },
            grid: {
              drawOnChartArea: false,
            },
            min: 0
          }
        }
      }
    })

      console.log('SGPA Credits chart created successfully:', window.sgpaCreditsChart)
    } catch (chartError) {
      console.error('Error creating Chart.js instance:', chartError)
      const canvas = document.getElementById('sgpaCreditsChart')
      if (canvas && canvas.parentElement) {
        canvas.parentElement.innerHTML = `<p style="text-align: center; color: #e74c3c; padding: 40px;">Error creating chart: ${chartError.message}</p>`
      }
    }
  } catch (error) {
    console.error('Error creating SGPA Credits chart:', error)
    const canvas = document.getElementById('sgpaCreditsChart')
    if (canvas && canvas.parentElement) {
      canvas.parentElement.innerHTML = `<p style="text-align: center; color: #e74c3c; padding: 40px;">Error creating chart: ${error.message}</p>`
    }
  }
}

function createSGPATrendChart(semesters) {
  try {
    console.log('Attempting to create SGPA Trend chart...')

    const canvas = document.getElementById('sgpaTrendChart')
    if (!canvas) {
      console.error('SGPA Trend chart canvas not found')
      return
    }

    console.log('Trend chart canvas found:', canvas)

    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
      console.error('Chart.js is not loaded for trend chart')
      canvas.parentElement.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">Chart.js library not loaded.</p>'
      return
    }

    const ctx = canvas.getContext('2d')
    console.log('Trend chart canvas context:', ctx)

    // Destroy existing chart if it exists
    if (window.sgpaTrendChart && typeof window.sgpaTrendChart.destroy === 'function') {
      console.log('Destroying existing trend chart')
      window.sgpaTrendChart.destroy()
      window.sgpaTrendChart = null
    }

    if (!semesters || semesters.length === 0) {
      console.log('No semester data for SGPA Trend chart')
      canvas.parentElement.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No semester data available for trend chart.</p>'
      return
    }

    const labels = semesters.map((sem, index) => sem.semester || `Semester ${index + 1}`)
    const sgpaData = semesters.map(sem => parseFloat(sem.sgpa) || 0)

    console.log('Trend chart data prepared:', { labels, sgpaData })

    // Find peak and lowest values
    const maxValue = Math.max(...sgpaData)
    const minValue = Math.min(...sgpaData)
    const maxIndex = sgpaData.indexOf(maxValue)
    const minIndex = sgpaData.indexOf(minValue)

    // Function to get color based on SGPA value with gradient
    function getGradientColor(value, min, max) {
      if (max === min) {
        return '#6c5ce7' // Default purple if all values are same
      }

      // Normalize value between 0 and 1
      const normalized = (value - min) / (max - min)

      // Define color stops: Red -> Orange -> Light Yellow -> Green
      if (normalized <= 0.33) {
        // Red to Orange (0 to 0.33)
        const ratio = normalized / 0.33
        const r = 231 // Red component stays high
        const g = Math.round(76 + (165 - 76) * ratio) // 76 to 165
        const b = 60 // Blue component stays low
        return `rgb(${r}, ${g}, ${b})`
      } else if (normalized <= 0.66) {
        // Orange to Light Yellow (0.33 to 0.66)
        const ratio = (normalized - 0.33) / 0.33
        const r = Math.round(231 + (255 - 231) * ratio) // 231 to 255 (bright)
        const g = Math.round(165 + (255 - 165) * ratio) // 165 to 255 (very bright)
        const b = Math.round(60 + (150 - 60) * ratio) // 60 to 150 (much lighter)
        return `rgb(${r}, ${g}, ${b})`
      } else {
        // Light Yellow to Green (0.66 to 1)
        const ratio = (normalized - 0.66) / 0.34
        const r = Math.round(255 + (0 - 255) * ratio) // 255 to 0
        const g = Math.round(255 + (184 - 255) * ratio) // 255 to 184
        const b = Math.round(150 + (148 - 150) * ratio) // 150 to 148
        return `rgb(${r}, ${g}, ${b})`
      }
    }

    // Function to get performance label
    function getPerformanceLabel(value, min, max) {
      if (max === min) return 'Consistent'

      const normalized = (value - min) / (max - min)
      if (normalized <= 0.25) return 'Needs Improvement'
      else if (normalized <= 0.5) return 'Below Average'
      else if (normalized <= 0.75) return 'Good Performance'
      else return 'Excellent Performance'
    }

    // Create point colors array with gradient
    const pointColors = sgpaData.map(value => getGradientColor(value, minValue, maxValue))

    // Create border colors for better visibility (darker borders for light colors)
    const borderColors = pointColors.map(color => {
      // If it's a light yellow color, use a darker border
      if (color.includes('255, 255') || color.includes('254, 254')) {
        return '#b8860b' // Dark goldenrod for light yellow points
      }
      return '#fff' // White for other colors
    })

    // Create point radius array - make extreme values slightly larger
    const pointRadii = sgpaData.map((value, index) => {
      if (maxValue !== minValue) {
        if (index === maxIndex && value === maxValue) {
          return 9 // Slightly larger for peak
        } else if (index === minIndex && value === minValue) {
          return 9 // Slightly larger for lowest
        }
      }
      return 7 // Default size (increased from 6)
    })

    console.log('Peak value:', maxValue, 'at index:', maxIndex)
    console.log('Lowest value:', minValue, 'at index:', minIndex)

    // Set canvas size
    canvas.width = 400
    canvas.height = 200

    try {
      window.sgpaTrendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'SGPA Trend',
          data: sgpaData,
          borderColor: 'rgba(108, 92, 231, 1)',
          backgroundColor: 'rgba(108, 92, 231, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: pointColors,
          pointBorderColor: borderColors,
          pointBorderWidth: 3,
          pointRadius: pointRadii,
          pointHoverRadius: pointRadii.map(r => r + 2),
          pointHoverBorderWidth: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const value = context.parsed.y
                const index = context.dataIndex
                let label = `SGPA: ${value}`

                // Add performance level based on gradient
                const performanceLabel = getPerformanceLabel(value, minValue, maxValue)

                if (maxValue !== minValue) {
                  if (index === maxIndex && value === maxValue) {
                    label += ` 🏆 (${performanceLabel})`
                  } else if (index === minIndex && value === minValue) {
                    label += ` ⚠️ (${performanceLabel})`
                  } else {
                    label += ` (${performanceLabel})`
                  }
                } else {
                  label += ` (${performanceLabel})`
                }

                return label
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 10,
            title: {
              display: true,
              text: 'SGPA'
            }
          },
          x: {
            title: {
              display: true,
              text: 'Semester'
            }
          }
        }
      }
    })

      console.log('SGPA Trend chart created successfully:', window.sgpaTrendChart)
    } catch (chartError) {
      console.error('Error creating Chart.js trend instance:', chartError)
      const canvas = document.getElementById('sgpaTrendChart')
      if (canvas && canvas.parentElement) {
        canvas.parentElement.innerHTML = `<p style="text-align: center; color: #e74c3c; padding: 40px;">Error creating trend chart: ${chartError.message}</p>`
      }
    }
  } catch (error) {
    console.error('Error creating SGPA Trend chart:', error)
    const canvas = document.getElementById('sgpaTrendChart')
    if (canvas && canvas.parentElement) {
      canvas.parentElement.innerHTML = `<p style="text-align: center; color: #e74c3c; padding: 40px;">Error creating trend chart: ${error.message}</p>`
    }
  }
}

function populateSemesterTable(semesters) {
  const tableBody = document.getElementById('semesterDetailsTable')

  const tableHTML = semesters.map(semester => {
    // Determine performance level
    let performanceClass = 'performance-average'
    let performanceText = 'Average'

    if (semester.sgpa >= 9) {
      performanceClass = 'performance-excellent'
      performanceText = 'Excellent'
    } else if (semester.sgpa >= 8) {
      performanceClass = 'performance-good'
      performanceText = 'Good'
    } else if (semester.sgpa < 6) {
      performanceClass = 'performance-poor'
      performanceText = 'Needs Improvement'
    }

    return `
      <tr>
        <td><strong>${semester.semester}</strong></td>
        <td>${semester.sgpa}</td>
        <td>${semester.credits}</td>
        <td>${semester.grade_points.toFixed(2)}</td>
        <td><span class="performance-badge ${performanceClass}">${performanceText}</span></td>
      </tr>
    `
  }).join('')

  tableBody.innerHTML = tableHTML
}

function closeCGPAAnalysisModal() {
  const modal = document.getElementById('cgpaAnalysisModal')
  modal.style.display = 'none'

  // Destroy charts to prevent memory leaks
  if (window.sgpaCreditsChart && typeof window.sgpaCreditsChart.destroy === 'function') {
    window.sgpaCreditsChart.destroy()
    window.sgpaCreditsChart = null
  }
  if (window.sgpaTrendChart && typeof window.sgpaTrendChart.destroy === 'function') {
    window.sgpaTrendChart.destroy()
    window.sgpaTrendChart = null
  }
}

function exportCGPAAnalysis() {
  if (!currentCGPAData) {
    showNotification('No data to export', 'error')
    return
  }

  try {
    // Create export data
    const exportData = {
      cgpa: currentCGPAData.cgpa,
      scale: currentCGPAData.scale || 10,
      total_credits: currentCGPAData.total_credits,
      total_grade_points: currentCGPAData.total_grade_points,
      gpa_4_scale: currentCGPAData.gpa_4_scale,
      gpa_5_scale: currentCGPAData.gpa_5_scale,
      percentage: currentCGPAData.percentage || ((currentCGPAData.cgpa - 0.5) * 10).toFixed(1),
      semesters: currentCGPAData.semesters,
      calculated_at: currentCGPAData.calculated_at,
      exported_at: new Date().toISOString()
    }

    // Create and download file
    const dataStr = JSON.stringify(exportData, null, 2)
    const dataBlob = new Blob([dataStr], {type: 'application/json'})
    const url = URL.createObjectURL(dataBlob)

    const link = document.createElement('a')
    link.href = url
    link.download = `cgpa-analysis-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    showNotification('CGPA analysis exported successfully!', 'success')
  } catch (error) {
    console.error('Error exporting CGPA analysis:', error)
    showNotification('Error exporting analysis', 'error')
  }
}

// Initialize Chart.js check when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Initialize chart variables
  window.sgpaCreditsChart = null
  window.sgpaTrendChart = null

  // Check if Chart.js is loaded after a delay
  setTimeout(() => {
    if (typeof Chart !== 'undefined') {
      console.log('✅ Chart.js loaded successfully:', Chart.version)
    } else {
      console.error('❌ Chart.js failed to load')
      showNotification('Chart.js library failed to load. Charts may not display properly.', 'warning')
    }
  }, 2000)
})

// Add New Semester Functions
let currentCGPATimestamp = null

function openAddSemesterModal() {
  if (!currentCGPAData) {
    showNotification('No CGPA data available', 'error')
    return
  }

  // Set the scale based on current CGPA data
  const scaleSelect = document.getElementById('newSemesterScale')
  scaleSelect.value = currentCGPAData.scale || 10

  // Set next semester number
  const nextSemesterNum = (currentCGPAData.semesters?.length || 0) + 1
  document.getElementById('newSemesterName').value = `Semester ${nextSemesterNum}`

  // Show modal
  const modal = document.getElementById('addSemesterModal')
  modal.style.display = 'flex'

  // Add event listeners for preview
  addPreviewListeners()
}

function closeAddSemesterModal() {
  const modal = document.getElementById('addSemesterModal')
  modal.style.display = 'none'

  // Clear form
  document.getElementById('addSemesterForm').reset()
  document.getElementById('semesterPreview').style.display = 'none'

  // Remove event listeners
  removePreviewListeners()
}

function addPreviewListeners() {
  const inputs = ['newSemesterName', 'newSemesterSGPA', 'newSemesterCredits', 'newSemesterScale']
  inputs.forEach(id => {
    const element = document.getElementById(id)
    element.addEventListener('input', updateSemesterPreview)
  })
}

function removePreviewListeners() {
  const inputs = ['newSemesterName', 'newSemesterSGPA', 'newSemesterCredits', 'newSemesterScale']
  inputs.forEach(id => {
    const element = document.getElementById(id)
    element.removeEventListener('input', updateSemesterPreview)
  })
}

function updateSemesterPreview() {
  const name = document.getElementById('newSemesterName').value
  const sgpa = parseFloat(document.getElementById('newSemesterSGPA').value) || 0
  const credits = parseFloat(document.getElementById('newSemesterCredits').value) || 0
  const scale = parseFloat(document.getElementById('newSemesterScale').value) || 10

  if (name && sgpa > 0 && credits > 0) {
    const gradePoints = sgpa * credits

    document.getElementById('previewSemester').textContent = name
    document.getElementById('previewSGPA').textContent = sgpa.toFixed(2)
    document.getElementById('previewCredits').textContent = credits
    document.getElementById('previewGradePoints').textContent = gradePoints.toFixed(2)

    document.getElementById('semesterPreview').style.display = 'block'
  } else {
    document.getElementById('semesterPreview').style.display = 'none'
  }
}

function addNewSemester() {
  try {
    const name = document.getElementById('newSemesterName').value.trim()
    const sgpa = parseFloat(document.getElementById('newSemesterSGPA').value)
    const credits = parseFloat(document.getElementById('newSemesterCredits').value)
    const scale = parseFloat(document.getElementById('newSemesterScale').value)

    // Validation
    if (!name) {
      showNotification('Please enter semester name', 'error')
      return
    }

    if (!sgpa || sgpa <= 0 || sgpa > scale) {
      showNotification(`Please enter valid SGPA (0 - ${scale})`, 'error')
      return
    }

    if (!credits || credits <= 0) {
      showNotification('Please enter valid credits', 'error')
      return
    }

    // Create new semester object
    const newSemester = {
      semester: name,
      sgpa: sgpa,
      credits: credits,
      grade_points: sgpa * credits
    }

    // Add to current data
    const updatedSemesters = [...(currentCGPAData.semesters || []), newSemester]

    // Recalculate CGPA
    const totalCredits = updatedSemesters.reduce((sum, sem) => sum + sem.credits, 0)
    const totalGradePoints = updatedSemesters.reduce((sum, sem) => sum + sem.grade_points, 0)
    const newCGPA = totalGradePoints / totalCredits

    // Calculate scale conversions
    let gpa_4_scale, gpa_5_scale, gpa_10_scale, percentage

    if (scale === 10) {
      gpa_4_scale = ((newCGPA - 5) * 4) / 5
      gpa_5_scale = newCGPA / 2
      percentage = (newCGPA - 0.5) * 10
    } else if (scale === 5) {
      gpa_4_scale = (newCGPA * 4) / 5
      gpa_10_scale = newCGPA * 2
      percentage = (gpa_10_scale - 0.5) * 10
    } else if (scale === 4) {
      gpa_10_scale = (newCGPA * 5) + 5
      gpa_5_scale = gpa_10_scale / 2
      percentage = (gpa_10_scale - 0.5) * 10
    }

    // Create updated CGPA data
    const updatedCGPAData = {
      cgpa: parseFloat(newCGPA.toFixed(2)),
      scale: scale,
      total_credits: totalCredits,
      total_grade_points: parseFloat(totalGradePoints.toFixed(2)),
      semesters: updatedSemesters,
      gpa_4_scale: gpa_4_scale ? parseFloat(gpa_4_scale.toFixed(2)) : undefined,
      gpa_5_scale: gpa_5_scale ? parseFloat(gpa_5_scale.toFixed(2)) : undefined,
      gpa_10_scale: gpa_10_scale ? parseFloat(gpa_10_scale.toFixed(2)) : undefined,
      percentage: percentage ? parseFloat(percentage.toFixed(1)) : undefined,
      calculated_at: new Date().toISOString()
    }

    // Save updated data
    saveUpdatedCGPAData(updatedCGPAData)

  } catch (error) {
    console.error('Error adding new semester:', error)
    showNotification('Error adding semester', 'error')
  }
}

function saveUpdatedCGPAData(updatedData) {
  try {
    if (!currentCGPATimestamp) {
      // If no timestamp, create a new record
      return createNewCGPARecord(updatedData)
    }

    // Update the existing record using the stored timestamp
    fetch('/api/update_cgpa_record', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timestamp: currentCGPATimestamp,
        result: updatedData
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        showNotification('Error updating CGPA: ' + data.error, 'error')
        return
      }

      // Update current data
      currentCGPAData = updatedData

      // Refresh the analysis display
      displayCGPAAnalysis(updatedData)

      // Close the add semester modal
      closeAddSemesterModal()

      // Refresh history to show updated calculation
      loadHistory()

      showNotification('New semester added successfully! CGPA updated.', 'success')
    })
    .catch(error => {
      console.error('Error updating CGPA record:', error)
      showNotification('Error updating CGPA record', 'error')
    })

  } catch (error) {
    console.error('Error in saveUpdatedCGPAData:', error)
    showNotification('Error saving data', 'error')
  }
}

function createNewCGPARecord(updatedData) {
  // Create a new CGPA calculation record
  fetch('/api/calculate_cgpa', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      semesters: updatedData.semesters.map(sem => ({
        sgpa: sem.sgpa,
        credits: sem.credits
      })),
      scale: updatedData.scale
    })
  })
  .then(response => response.json())
  .then(data => {
    if (data.error) {
      showNotification('Error creating new CGPA record: ' + data.error, 'error')
      return
    }

    // Update current data
    currentCGPAData = updatedData

    // Refresh the analysis display
    displayCGPAAnalysis(updatedData)

    // Close the add semester modal
    closeAddSemesterModal()

    // Refresh history to show new calculation
    loadHistory()

    showNotification('New semester added successfully! New CGPA calculation created.', 'success')
  })
  .catch(error => {
    console.error('Error creating new CGPA record:', error)
    showNotification('Error creating new CGPA record', 'error')
  })
}



// Auto-refresh countdown every minute
setInterval(() => {
  if (currentTab === 'timetable') {
    loadExamCountdown()
  }
}, 60000)