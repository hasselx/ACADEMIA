from flask import Flask, render_template, request, jsonify, redirect, url_for, flash, session
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timedelta
import json
import os
import re
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import uuid
from dotenv import load_dotenv
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import threading
import time

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Use environment variables for configuration
app.secret_key = os.getenv('SECRET_KEY', 'fallback-secret-key-for-development')

# Session configuration using environment variables
app.config['SESSION_PERMANENT'] = False
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = os.getenv('FLASK_ENV') == 'production'
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=int(os.getenv('SESSION_TIMEOUT_MINUTES', '30')))

# Initialize Firebase using environment variables or service account file
db = None
try:
    # Try to use environment variables first
    firebase_config = {
        "type": "service_account",
        "project_id": os.getenv('FIREBASE_PROJECT_ID'),
        "private_key_id": os.getenv('FIREBASE_PRIVATE_KEY_ID'),
        "private_key": os.getenv('FIREBASE_PRIVATE_KEY', '').replace('\\n', '\n'),
        "client_email": os.getenv('FIREBASE_CLIENT_EMAIL'),
        "client_id": os.getenv('FIREBASE_CLIENT_ID'),
        "auth_uri": os.getenv('FIREBASE_AUTH_URI', 'https://accounts.google.com/o/oauth2/auth'),
        "token_uri": os.getenv('FIREBASE_TOKEN_URI', 'https://oauth2.googleapis.com/token'),
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": os.getenv('FIREBASE_CLIENT_CERT_URL')
    }
    
    # Check if all required Firebase environment variables are present
    required_firebase_vars = ['FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL']
    if all(os.getenv(var) for var in required_firebase_vars):
        print("Using Firebase configuration from environment variables")
        cred = credentials.Certificate(firebase_config)
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        print("Firebase initialized successfully from environment variables")
    else:
        # Fallback to service account file
        if os.path.exists('firebase_key.json'):
            print("Using Firebase configuration from service account file")
            cred = credentials.Certificate('firebase_key.json')
            firebase_admin.initialize_app(cred)
            db = firestore.client()
            print("Firebase initialized successfully from service account file")
        else:
            print("ERROR: No Firebase configuration found!")
            print("Please either:")
            print("1. Set Firebase environment variables in .env file, or")
            print("2. Place firebase_key.json in the project root")
            exit(1)
            
except Exception as e:
    print(f"ERROR: Firebase initialization failed: {e}")
    exit(1)

def get_user_profile_ref(username):
    """Get Firebase reference for user profile"""
    return db.collection('users').document('students').collection('profiles').document(username)

def get_user_data_ref(username):
    """Get Firebase reference for user data (cgpa, attendance, timetable, reminders)"""
    return db.collection('users').document('students').collection('profiles').document(username).collection('data')

def find_user_by_username(username):
    """Find user by username in Firebase"""
    try:
        user_ref = get_user_profile_ref(username)
        user_doc = user_ref.get()
        if user_doc.exists:
            return user_doc.to_dict()
        return None
    except Exception as e:
        print(f"Error finding user {username}: {e}")
        return None

def find_user_by_email(email):
    """Find user by email in Firebase"""
    try:
        users_ref = db.collection('users').document('students').collection('profiles')
        query = users_ref.where('email', '==', email).limit(1)
        docs = query.get()
        
        for doc in docs:
            return doc.id, doc.to_dict()
        return None, None
    except Exception as e:
        print(f"Error finding user by email {email}: {e}")
        return None, None

def create_user_profile(username, user_data):
    """Create user profile in Firebase"""
    try:
        user_ref = get_user_profile_ref(username)
        user_ref.set(user_data)
        print(f"User profile '{username}' created in Firebase")
        return True
    except Exception as e:
        print(f"Error creating user profile {username}: {e}")
        return False

def save_user_data(username, data_type, data):
    """Save user data (cgpa, attendance, timetable, reminders) to Firebase"""
    try:
        data_ref = get_user_data_ref(username).document(data_type)
        data_ref.set({
            'data': data,
            'updated_at': datetime.now().isoformat()
        })
        return True
    except Exception as e:
        print(f"Error saving {data_type} data for {username}: {e}")
        return False

def get_user_data(username, data_type):
    """Get user data (cgpa, attendance, timetable, reminders) from Firebase"""
    try:
        data_ref = get_user_data_ref(username).document(data_type)
        doc = data_ref.get()
        if doc.exists:
            return doc.to_dict().get('data', {})
        return {}
    except Exception as e:
        print(f"Error getting {data_type} data for {username}: {e}")
        return {}

def remove_duplicate_reminders(reminders_list):
    """Remove duplicate reminders based on title, type, and due_date"""
    seen = set()
    unique_reminders = []
    fixed_count = 0

    for reminder in reminders_list:
        # Auto-fix corrupted dates before processing
        due_date_str = reminder.get('due_date', '')
        if due_date_str:
            original_date = due_date_str

            # Fix dates with timezone + Z like +00:00Z
            if '+00:00Z' in due_date_str:
                due_date_str = due_date_str.replace('+00:00Z', 'Z')
                fixed_count += 1

            # Fix dates with double timezone suffixes like +00:00+00:00
            import re
            double_tz_pattern = r'(\+\d{2}:\d{2})\+\d{2}:\d{2}$'
            if re.search(double_tz_pattern, due_date_str):
                due_date_str = re.sub(double_tz_pattern, r'\1', due_date_str)
                fixed_count += 1

            # Update the reminder if we fixed the date
            if due_date_str != original_date:
                print(f"DEBUG: Auto-fixed corrupted date for '{reminder.get('title', 'Unknown')}': {original_date} -> {due_date_str}")
                reminder['due_date'] = due_date_str

        # Create a unique key based on title, type, and due_date
        key = (
            reminder.get('title', '').strip().lower(),
            reminder.get('type', '').strip().lower(),
            due_date_str.strip()
        )

        if key not in seen:
            seen.add(key)
            unique_reminders.append(reminder)
        else:
            print(f"DEBUG: Removing duplicate reminder: {reminder.get('title')} ({reminder.get('type')})")

    print(f"DEBUG: Removed {len(reminders_list) - len(unique_reminders)} duplicates")
    if fixed_count > 0:
        print(f"DEBUG: Auto-fixed {fixed_count} corrupted dates")
    return unique_reminders

def is_duplicate_reminder(new_reminder, existing_reminders):
    """Check if a new reminder is a duplicate of existing ones"""
    new_key = (
        new_reminder.get('title', '').strip().lower(),
        new_reminder.get('type', '').strip().lower(),
        new_reminder.get('due_date', '').strip()
    )

    for existing in existing_reminders:
        existing_key = (
            existing.get('title', '').strip().lower(),
            existing.get('type', '').strip().lower(),
            existing.get('due_date', '').strip()
        )
        if new_key == existing_key:
            return True
    return False

def add_user_calculation(username, calc_type, calculation_data):
    """Add calculation record to user's data"""
    try:
        # Get existing calculations
        calculations = get_user_data(username, 'calculations')
        if not calculations:
            calculations = {'cgpa': [], 'attendance': []}
        
        # Add new calculation
        if calc_type not in calculations:
            calculations[calc_type] = []
        
        calculation_record = {
            'result': calculation_data,
            'timestamp': datetime.now().isoformat()
        }
        calculations[calc_type].append(calculation_record)
        
        # Keep only last 50 records
        calculations[calc_type] = calculations[calc_type][-50:]
        
        # Save back to Firebase
        return save_user_data(username, 'calculations', calculations)
    except Exception as e:
        print(f"Error adding {calc_type} calculation for {username}: {e}")
        return False

def parse_time_from_text(text):
    """Parse time from various text formats"""
    import re

    text = text.lower().strip()

    # Time patterns
    time_patterns = [
        # 12-hour format with AM/PM (e.g., "11:59 PM", "11am", "1:30 pm")
        (r'(\d{1,2}):?(\d{2})?\s*(am|pm)', lambda m: (
            int(m.group(1)) % 12 + (12 if m.group(3) == 'pm' else 0),
            int(m.group(2)) if m.group(2) else 0
        )),
        # O'clock variations (e.g., "12 o'clock", "12'o clock", "12 oclock")
        (r'(\d{1,2})\s*[\'o]*\s*clock', lambda m: (int(m.group(1)) % 24, 0)),
        # 24-hour format (e.g., "23:59", "1430")
        (r'(\d{1,2}):(\d{2})', lambda m: (int(m.group(1)), int(m.group(2)))),
        # 4-digit time format (e.g., "1159", "0800")
        (r'\b(\d{4})\b', lambda m: (int(m.group(1)[:2]), int(m.group(1)[2:]))),
        # Simple hour with AM/PM (e.g., "11am", "3pm")
        (r'\b(\d{1,2})\s*(am|pm)', lambda m: (
            int(m.group(1)) % 12 + (12 if m.group(2) == 'pm' else 0), 0
        )),
    ]

    for pattern, converter in time_patterns:
        match = re.search(pattern, text)
        if match:
            try:
                hour, minute = converter(match)
                if 0 <= hour <= 23 and 0 <= minute <= 59:
                    return hour, minute
            except (ValueError, IndexError):
                continue

    return None

def parse_date_from_text(text):
    """Parse date and time from various text formats including WhatsApp and email formats"""
    import re
    from datetime import datetime, timedelta

    text = text.lower().strip()
    today = datetime.now()

    # Month name mappings for different formats
    months = {
        'january': 1, 'jan': 1, 'february': 2, 'feb': 2, 'march': 3, 'mar': 3,
        'april': 4, 'apr': 4, 'may': 5, 'june': 6, 'jun': 6,
        'july': 7, 'jul': 7, 'august': 8, 'aug': 8, 'september': 9, 'sep': 9, 'sept': 9,
        'october': 10, 'oct': 10, 'november': 11, 'nov': 11, 'december': 12, 'dec': 12
    }

    # Enhanced date patterns
    patterns = [
        # DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
        (r'(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})', lambda m: datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)))),
        # MM/DD/YYYY (US format)
        (r'(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})', lambda m: datetime(int(m.group(3)), int(m.group(1)), int(m.group(2)))),
        # DD/MM, DD-MM, DD.MM (current year)
        (r'(\d{1,2})[/\-\.](\d{1,2})(?![/\-\.]\d)', lambda m: datetime(today.year, int(m.group(2)), int(m.group(1)))),
        # YYYY-MM-DD (ISO format)
        (r'(\d{4})[/\-\.](\d{1,2})[/\-\.](\d{1,2})', lambda m: datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))),
        # Month DD, YYYY or Month DD
        (r'(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2}),?\s*(\d{4})?',
         lambda m: datetime(int(m.group(3)) if m.group(3) else today.year, months[m.group(1)], int(m.group(2)))),
        # DD Month YYYY or DD Month
        (r'(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s*(\d{4})?',
         lambda m: datetime(int(m.group(3)) if m.group(3) else today.year, months[m.group(2)], int(m.group(1)))),
        # DDth/st/nd/rd Month YYYY (e.g., "14th July", "1st March")
        (r'(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s*(\d{4})?',
         lambda m: datetime(int(m.group(3)) if m.group(3) else today.year, months[m.group(2)], int(m.group(1)))),
        # Month DDth/st/nd/rd (e.g., "July 14th", "March 1st")
        (r'(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(\d{4})?',
         lambda m: datetime(int(m.group(3)) if m.group(3) else today.year, months[m.group(1)], int(m.group(2)))),
    ]

    # Enhanced relative dates
    relative_patterns = [
        (r'\btoday\b', lambda: today),
        (r'\btomorrow\b', lambda: today + timedelta(days=1)),
        (r'\byesterday\b', lambda: today - timedelta(days=1)),
        (r'\bnext week\b', lambda: today + timedelta(days=7)),
        (r'\bnext month\b', lambda: today + timedelta(days=30)),
        (r'\bin (\d+) days?\b', lambda m: today + timedelta(days=int(m.group(1)))),
        (r'\bin (\d+) weeks?\b', lambda m: today + timedelta(weeks=int(m.group(1)))),
        (r'\bin a week\b', lambda: today + timedelta(days=7)),
        (r'\bin a month\b', lambda: today + timedelta(days=30)),
        (r'\bday after tomorrow\b', lambda: today + timedelta(days=2)),
        (r'\bthis (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b',
         lambda m: today + timedelta(days=((['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].index(m.group(1)) - today.weekday()) % 7))),
        (r'\bnext (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b',
         lambda m: today + timedelta(days=(((['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].index(m.group(1)) - today.weekday()) % 7) or 7))),
    ]

    # Parse date first
    parsed_date = None

    # Try relative patterns first
    for pattern, converter in relative_patterns:
        match = re.search(pattern, text)
        if match:
            try:
                # Check if the lambda expects arguments by checking parameter count
                import inspect
                sig = inspect.signature(converter)
                if len(sig.parameters) > 0:
                    parsed_date = converter(match)
                else:
                    parsed_date = converter()
                break
            except (ValueError, IndexError, TypeError):
                continue

    # If no relative date found, try day names
    if not parsed_date:
        days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        for i, day in enumerate(days):
            if f' {day}' in text or text.startswith(day):
                days_ahead = i - today.weekday()
                if days_ahead <= 0:  # Target day already happened this week
                    days_ahead += 7
                parsed_date = today + timedelta(days=days_ahead)
                break

    # If no relative date found, try date patterns
    if not parsed_date:
        for pattern, converter in patterns:
            match = re.search(pattern, text)
            if match:
                try:
                    parsed_date = converter(match)
                    break
                except (ValueError, IndexError):
                    continue

    # If no date found, default to today
    if not parsed_date:
        parsed_date = today

    # Now parse time and combine with date
    time_info = parse_time_from_text(text)
    if time_info:
        hour, minute = time_info
        # Replace the time in the parsed date
        parsed_date = parsed_date.replace(hour=hour, minute=minute, second=0, microsecond=0)
    else:
        # If no time specified, default to 11:59 PM for assignments/projects, 9:00 AM for exams, 2:00 PM for labs
        if any(keyword in text for keyword in ['assignment', 'homework', 'submit', 'due', 'project']):
            parsed_date = parsed_date.replace(hour=23, minute=59, second=0, microsecond=0)
        elif any(keyword in text for keyword in ['exam', 'test', 'quiz', 'examination']):
            parsed_date = parsed_date.replace(hour=9, minute=0, second=0, microsecond=0)
        elif any(keyword in text for keyword in ['lab', 'laboratory', 'labsheet', 'practical']):
            parsed_date = parsed_date.replace(hour=14, minute=0, second=0, microsecond=0)  # 2:00 PM for labs
        else:
            # Default to end of day for other reminders
            parsed_date = parsed_date.replace(hour=23, minute=59, second=0, microsecond=0)

    return parsed_date

def classify_reminder_type(text):
    """Enhanced classification of reminder type based on text content with weighted scoring"""
    text = text.lower()

    # Enhanced keywords with weights
    exam_keywords = {
        'exam': 3, 'examination': 3, 'test': 2, 'quiz': 2, 'midterm': 3, 'final': 3,
        'assessment': 2, 'evaluation': 2, 'viva': 3, 'oral': 2, 'written': 1,
        'hall': 2, 'room': 1, 'invigilator': 3, 'duration': 2, 'marks': 1
    }

    assignment_keywords = {
        'assignment': 3, 'homework': 3, 'task': 2, 'submit': 2, 'submission': 2,
        'due': 2, 'deadline': 3, 'upload': 2, 'file': 1, 'document': 1,
        'pdf': 1, 'word': 1, 'plagiarism': 2, 'turnitin': 2, 'late': 2,
        'penalty': 2, 'extension': 2, 'work': 1
    }

    project_keywords = {
        'project': 4, 'presentation': 3, 'seminar': 3, 'thesis': 3, 'research': 3,
        'report': 2, 'paper': 2, 'study': 1, 'analysis': 2, 'survey': 2,
        'experiment': 2, 'data': 1, 'findings': 2, 'conclusion': 2, 'abstract': 2,
        'bibliography': 2, 'references': 2, 'slides': 2, 'ppt': 2, 'powerpoint': 2,
        'demo': 2, 'prototype': 2, 'implementation': 2
    }

    lab_keywords = {
        'lab': 4, 'laboratory': 4, 'labsheet': 4, 'lab sheet': 4, 'practical': 3,
        'experiment': 3, 'observation': 2, 'procedure': 2, 'apparatus': 2,
        'specimen': 2, 'sample': 2, 'microscope': 2, 'beaker': 2, 'flask': 2,
        'titration': 3, 'reaction': 2, 'solution': 2, 'compound': 2, 'element': 2,
        'circuit': 2, 'voltage': 2, 'current': 2, 'resistance': 2, 'oscilloscope': 2,
        'manual': 2, 'protocol': 2, 'safety': 2, 'gloves': 2, 'goggles': 2
    }

    # Calculate weighted scores
    exam_score = sum(weight for keyword, weight in exam_keywords.items() if keyword in text)
    assignment_score = sum(weight for keyword, weight in assignment_keywords.items() if keyword in text)
    project_score = sum(weight for keyword, weight in project_keywords.items() if keyword in text)
    lab_score = sum(weight for keyword, weight in lab_keywords.items() if keyword in text)

    # Context-based adjustments
    if any(phrase in text for phrase in ['group project', 'team project', 'final project', 'project submission']):
        project_score += 6  # Strong indicator for project

    if any(phrase in text for phrase in ['individual assignment', 'personal task', 'homework']):
        assignment_score += 3

    if any(phrase in text for phrase in ['final exam', 'midterm exam', 'entrance exam']):
        exam_score += 5

    # Special case: "project submission" should always be project, not assignment
    if 'project submission' in text:
        project_score += 10  # Very strong indicator

    # Time-based hints
    if any(phrase in text for phrase in ['at', 'hall', 'room', 'venue', 'location']):
        exam_score += 2  # Exams usually have specific venues

    if any(phrase in text for phrase in ['before', 'by', 'deadline', 'submit by']):
        assignment_score += 2  # Assignments have submission deadlines

    # Subject-specific patterns
    if any(phrase in text for phrase in ['lab report', 'practical', 'experiment']):
        lab_score += 3  # Changed from assignment_score to lab_score

    if any(phrase in text for phrase in ['defense', 'viva', 'presentation']):
        project_score += 3

    # Lab-specific context adjustments
    if any(phrase in text for phrase in ['lab session', 'lab work', 'lab manual', 'lab procedure']):
        lab_score += 5

    if any(phrase in text for phrase in ['chemistry lab', 'physics lab', 'biology lab', 'computer lab']):
        lab_score += 4

    # Return type with highest score, with minimum threshold
    max_score = max(exam_score, assignment_score, project_score, lab_score)

    if max_score == 0:
        return 'assignment'  # Default fallback

    if exam_score == max_score:
        return 'exam'
    elif assignment_score == max_score:
        return 'assignment'
    elif project_score == max_score:
        return 'project'
    else:
        return 'lab'

def extract_title_from_message(text, reminder_type):
    """Extract a meaningful title from the message text"""
    import re

    text = text.strip()
    lines = text.split('\n')

    # Remove common email/message prefixes
    first_line = lines[0] if lines else text
    first_line = re.sub(r'^(re:|fwd:|subject:|from:|to:)', '', first_line, flags=re.IGNORECASE).strip()

    print(f"🔍 DEBUG: extract_title_from_message called with text: '{text}', type: '{reminder_type}'")

    # Look for subject-specific patterns (ordered by priority)
    subject_patterns = [
        # Lab-specific patterns (highest priority for lab reminders)
        r'having\s+([A-Z][A-Z\s]*?)\s+lab',  # "having ELECTRONICS lab" - captures just the subject
        r'([A-Z][A-Z\s]*?)\s+lab(?:\s+on|\s+at|\s+session|\s*$)',  # "ELECTRONICS LAB" - captures just the subject
        r'([A-Z][A-Z\s]*?)\s+laboratory',  # "ELECTRONICS laboratory"
        r'([A-Z][A-Z\s]*?)\s+practical',  # "ELECTRONICS practical"

        # Pattern for "FOR [SUBJECT]" - most common in academic messages
        r'for\s+([\w\s]+?)(?:\s+on|\s+at|\s*$)',
        r'in\s+([\w\s]+?)(?:\s+on|\s+at|\s*$)',
        # Pattern for "your [SUBJECT] assignment/exam/project" - extract just the subject
        r'your\s+([\w\s]+?)\s+(assignment|homework|task|exam|test|quiz|project|presentation)',
        # Pattern for "submit your [SUBJECT] assignment" - extract just the subject
        r'submit\s+your\s+([\w\s]+?)\s+(assignment|homework|task|exam|test|quiz|project)',
        # Pattern for "[SUBJECT] assignment/exam/project"
        r'([\w\s]+?)\s+(assignment|homework|task|exam|test|quiz|project|presentation)',
        # Pattern for "[SUBJECT] is due"
        r'([\w\s]+?)\s+is\s+due',
        # Pattern for "[SUBJECT] submission"
        r'([\w\s]+?)\s+submission',
        # Pattern for general "submit [SUBJECT]" (fallback)
        r'submit\s+([\w\s]+?)(?:\s+on|\s+at|\s*$)',
    ]

    for i, pattern in enumerate(subject_patterns):
        print(f"🔍 DEBUG: Trying pattern {i+1}: '{pattern}' on text: '{text}'")
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            title = match.group(1).strip()
            print(f"✅ DEBUG: Pattern '{pattern}' matched: '{title}' from text: '{text}'")
            # Clean up the title
            title = re.sub(r'\b(the|a|an)\b', '', title, flags=re.IGNORECASE).strip()
            if len(title) > 2 and len(title) < 50:
                # For lab reminders, add "LAB" suffix if not already present
                if reminder_type == 'lab' and 'lab' not in title.lower():
                    final_title = f"{title.upper()} LAB"
                    print(f"🧪 DEBUG: Lab title created: '{final_title}'")
                    return final_title
                print(f"📝 DEBUG: Title extracted: '{title.upper()}'")
                return title.upper()  # Return in uppercase for consistency
        else:
            print(f"❌ DEBUG: Pattern {i+1} did not match")

    # Fallback: use first meaningful sentence
    sentences = re.split(r'[.!?]', first_line)
    for sentence in sentences:
        sentence = sentence.strip()
        if len(sentence) > 10 and len(sentence) < 100:
            # Remove common words at the beginning
            sentence = re.sub(r'^(hi|hello|dear|students|reminder|notice|important)', '', sentence, flags=re.IGNORECASE).strip()
            if sentence:
                return sentence[:50] + ('...' if len(sentence) > 50 else '')

    # Final fallback
    if len(first_line) > 10:
        return first_line[:50] + ('...' if len(first_line) > 50 else '')

    return f"{reminder_type.title()} Reminder"

def send_email_reminder(user_email, reminder_data):
    """Send email reminder to user"""
    try:
        # Email configuration from environment variables
        smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
        smtp_port = int(os.getenv('SMTP_PORT', '587'))
        sender_email = os.getenv('SENDER_EMAIL')
        sender_password = os.getenv('SENDER_PASSWORD')

        print(f"🔧 DEBUG: Email config - Server: {smtp_server}, Port: {smtp_port}")
        print(f"📧 DEBUG: Sender email: {sender_email}")
        print(f"🔑 DEBUG: Password configured: {'Yes' if sender_password else 'No'}")
        print(f"📨 DEBUG: Recipient: {user_email}")
        print(f"🔍 DEBUG: Password length: {len(sender_password) if sender_password else 0}")
        print(f"🔍 DEBUG: Password starts with: {sender_password[:4] if sender_password else 'None'}...")

        if not sender_email or not sender_password:
            print("❌ Email credentials not configured in .env file")
            return False

        if sender_email == 'your-system-email@gmail.com':
            print("❌ Email credentials are still placeholder values")
            return False

        # Create message
        msg = MIMEMultipart()
        msg['From'] = sender_email
        msg['To'] = user_email
        msg['Subject'] = f"Reminder: {reminder_data['title']}"

        # Email body
        body = f"""
        Hello!

        This is a reminder about your upcoming {reminder_data['type']}:

        Title: {reminder_data['title']}
        Type: {reminder_data['type'].title()}
        Due Date: {reminder_data.get('formatted_due_date', 'Not specified')}
        Description: {reminder_data.get('description', 'No description')}

        Status: {reminder_data.get('countdown', 'No due date')}

        Don't forget to complete this task on time!

        Best regards,
        Smart Student Reminder System
        """

        msg.attach(MIMEText(body, 'plain'))

        # Send email
        print(f"DEBUG: Attempting to connect to {smtp_server}:{smtp_port}")
        server = smtplib.SMTP(smtp_server, smtp_port)
        print("DEBUG: Connected to SMTP server")

        server.starttls()
        print("DEBUG: Started TLS")

        server.login(sender_email, sender_password)
        print("DEBUG: Logged in successfully")

        text = msg.as_string()
        server.sendmail(sender_email, user_email, text)
        print("DEBUG: Email sent successfully")

        server.quit()
        print(f"✅ Email reminder sent to {user_email} for: {reminder_data['title']}")
        return True

    except smtplib.SMTPAuthenticationError as e:
        print(f"❌ SMTP Authentication Error: {e}")
        print("❌ This usually means:")
        print("   - Wrong email/password")
        print("   - App password expired")
        print("   - 2FA not enabled on Gmail")
        return False
    except smtplib.SMTPConnectError as e:
        print(f"❌ SMTP Connection Error: {e}")
        print("❌ This usually means:")
        print("   - Network/firewall blocking SMTP")
        print("   - Wrong SMTP server/port")
        return False
    except smtplib.SMTPException as e:
        print(f"❌ SMTP Error: {e}")
        print(f"❌ SMTP Error type: {type(e).__name__}")
        return False
    except Exception as e:
        print(f"❌ General Error sending email reminder: {e}")
        print(f"❌ Error type: {type(e).__name__}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        return False

def check_and_send_email_reminders():
    """Check for reminders that need email notifications and send them"""
    try:
        print("🔔 Starting automatic email reminder check...")
        notifications_sent = 0

        # Get all users from Firebase
        users_ref = db.collection('users').document('students').collection('profiles')
        users = users_ref.get()

        for user_doc in users:
            username = user_doc.id
            user_data = user_doc.to_dict()
            user_email = user_data.get('email')

            if not user_email:
                continue

            print(f"📧 Checking reminders for user: {username} ({user_email})")

            # Get user's email settings
            email_settings_data = get_user_data(username, 'email_settings')
            email_settings = email_settings_data.get('settings', {}) if email_settings_data else {}

            # Skip if email notifications are disabled
            if not email_settings.get('enabled', False):
                print(f"⏭️ Email notifications disabled for {username}")
                continue

            # Get user's reminders
            reminders_data = get_user_data(username, 'reminders')
            if not reminders_data or 'reminders' not in reminders_data:
                continue

            reminders = reminders_data['reminders']
            now = datetime.now()

            for reminder in reminders:
                if reminder.get('completed', False):
                    continue

                due_date_str = reminder.get('due_date')
                if not due_date_str:
                    continue

                try:
                    # Clean up corrupted dates with double timezone suffixes
                    import re
                    cleaned_date_str = due_date_str

                    # Fix dates with timezone + Z like +00:00Z
                    if '+00:00Z' in cleaned_date_str:
                        cleaned_date_str = cleaned_date_str.replace('+00:00Z', 'Z')

                    # Fix dates with double timezone suffixes like +00:00+00:00
                    double_tz_pattern = r'(\+\d{2}:\d{2})\+\d{2}:\d{2}$'
                    if re.search(double_tz_pattern, cleaned_date_str):
                        # Remove the duplicate timezone suffix
                        cleaned_date_str = re.sub(double_tz_pattern, r'\1', cleaned_date_str)

                    # Parse due date and handle timezone
                    if cleaned_date_str.endswith('Z'):
                        due_date = datetime.fromisoformat(cleaned_date_str.replace('Z', '+00:00'))
                    elif '+' in cleaned_date_str or cleaned_date_str.endswith('00:00'):
                        due_date = datetime.fromisoformat(cleaned_date_str)
                    else:
                        # Assume local timezone if no timezone info
                        due_date = datetime.fromisoformat(cleaned_date_str)

                    # Make sure both datetimes are timezone-naive for comparison
                    if due_date.tzinfo is not None:
                        # Convert to local time first, then remove timezone info
                        due_date = due_date.astimezone().replace(tzinfo=None)

                    time_diff = due_date - now
                    hours_until_due = time_diff.total_seconds() / 3600

                    print(f"⏰ DEBUG: Reminder '{reminder['title']}' - Due: {due_date}, Now: {now}, Hours until due: {hours_until_due:.2f}")

                    # Check if we should send notification
                    should_notify = False
                    notification_type = ""

                    if hours_until_due < 0 and email_settings.get('notify_overdue', True):
                        # Overdue
                        should_notify = True
                        notification_type = "overdue"
                    elif 0.5 <= hours_until_due <= 1.5 and email_settings.get('notify_1h', True):
                        # Due in 1 hour (with 30-minute window)
                        should_notify = True
                        notification_type = "1_hour"
                    elif 23 <= hours_until_due <= 25 and email_settings.get('notify_24h', True):
                        # Due in 24 hours (with 1-hour window)
                        should_notify = True
                        notification_type = "24_hour"

                    if should_notify:
                        # Check if we already sent this notification
                        notification_key = f"{reminder['id']}_{notification_type}"
                        sent_notifications = get_user_data(username, 'sent_notifications')
                        sent_list = sent_notifications.get('notifications', []) if sent_notifications else []

                        if notification_key not in sent_list:
                            print(f"📨 Sending {notification_type} notification for: {reminder['title']}")

                            # Enhance reminder data for email
                            enhanced_reminder = {
                                **reminder,
                                'formatted_due_date': due_date.strftime('%A, %B %d, %Y at %I:%M %p'),
                                'notification_type': notification_type
                            }

                            # Send email
                            if send_email_reminder(user_email, enhanced_reminder):
                                # Mark notification as sent
                                sent_list.append(notification_key)
                                save_user_data(username, 'sent_notifications', {'notifications': sent_list})
                                notifications_sent += 1
                                print(f"✅ Notification sent successfully")
                            else:
                                print(f"❌ Failed to send notification")
                        else:
                            print(f"⏭️ Notification already sent for {reminder['title']} ({notification_type})")

                except Exception as e:
                    print(f"❌ Error processing reminder {reminder.get('title', 'Unknown')}: {e}")
                    print(f"❌ Problematic due_date: {due_date_str}")
                    continue

        print(f"🔔 Email reminder check complete. Sent {notifications_sent} notifications.")
        return notifications_sent

    except Exception as e:
        print(f"❌ Error checking email reminders: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        return 0

def background_email_checker():
    """Background thread to check for email reminders every 30 minutes"""
    while True:
        try:
            print("🔄 Running background email reminder check...")
            check_and_send_email_reminders()
            # Wait 30 minutes before next check
            time.sleep(30 * 60)  # 30 minutes
        except Exception as e:
            print(f"❌ Error in background email checker: {e}")
            time.sleep(60)  # Wait 1 minute before retrying

def generate_indian_holidays(year):
    """Generate Indian holidays for any given year"""
    holidays = []

    # Fixed date holidays (same every year)
    fixed_holidays = [
        {'month': 1, 'day': 1, 'name': "New Year's Day", 'type': 'national', 'description': 'The first day of the Gregorian calendar year, celebrated worldwide.'},
        {'month': 1, 'day': 26, 'name': 'Republic Day', 'type': 'national', 'description': 'Commemorates the adoption of the Constitution of India.'},
        {'month': 5, 'day': 1, 'name': 'Labour Day', 'type': 'national', 'description': 'International Workers Day, celebrating laborers and the working class.'},
        {'month': 8, 'day': 15, 'name': 'Independence Day', 'type': 'national', 'description': f'Commemorates India\'s independence from British rule in 1947.'},
        {'month': 10, 'day': 2, 'name': 'Gandhi Jayanti', 'type': 'national', 'description': 'Birthday of Mahatma Gandhi, the Father of the Nation.'},
        {'month': 12, 'day': 25, 'name': 'Christmas Day', 'type': 'religious', 'description': 'Christian festival celebrating the birth of Jesus Christ.'},
    ]

    # Add fixed holidays
    for holiday in fixed_holidays:
        holidays.append({
            'date': f'{year}-{holiday["month"]:02d}-{holiday["day"]:02d}',
            'name': holiday['name'],
            'type': holiday['type'],
            'description': holiday['description']
        })

    # Year-specific holidays (these change each year)
    year_specific = {
        2024: [
            {'date': '2024-01-14', 'name': 'Makar Sankranti', 'type': 'religious', 'description': 'Hindu festival marking the transition of the sun into Capricorn.'},
            {'date': '2024-03-08', 'name': 'Holi', 'type': 'festival', 'description': 'Festival of colors, celebrating the arrival of spring.'},
            {'date': '2024-04-14', 'name': 'Vishu', 'type': 'state', 'description': 'Malayalam New Year, celebrated with traditional rituals and feasts.'},
            {'date': '2024-09-15', 'name': 'Onam (Thiruvonam)', 'type': 'state', 'description': 'Kerala\'s most important festival, celebrating King Mahabali\'s return.'},
            {'date': '2024-11-01', 'name': 'Diwali', 'type': 'festival', 'description': 'Festival of lights, one of the most important Hindu festivals.'},
        ],
        2025: [
            {'date': '2025-01-14', 'name': 'Makar Sankranti', 'type': 'religious', 'description': 'Hindu festival marking the transition of the sun into Capricorn.'},
            {'date': '2025-02-26', 'name': 'Maha Shivratri', 'type': 'religious', 'description': 'Hindu festival dedicated to Lord Shiva.'},
            {'date': '2025-03-13', 'name': 'Holi', 'type': 'festival', 'description': 'Festival of colors, celebrating the arrival of spring.'},
            {'date': '2025-04-13', 'name': 'Vishu', 'type': 'state', 'description': 'Malayalam New Year, celebrated with traditional rituals and feasts.'},
            {'date': '2025-09-05', 'name': 'Onam (Thiruvonam)', 'type': 'state', 'description': 'Kerala\'s most important festival, celebrating King Mahabali\'s return.'},
            {'date': '2025-11-09', 'name': 'Diwali', 'type': 'festival', 'description': 'Festival of lights, one of the most important Hindu festivals.'},
        ],
        2026: [
            {'date': '2026-01-14', 'name': 'Makar Sankranti', 'type': 'religious', 'description': 'Hindu festival marking the transition of the sun into Capricorn.'},
            {'date': '2026-03-03', 'name': 'Holi', 'type': 'festival', 'description': 'Festival of colors, celebrating the arrival of spring.'},
            {'date': '2026-04-14', 'name': 'Vishu', 'type': 'state', 'description': 'Malayalam New Year, celebrated with traditional rituals and feasts.'},
            {'date': '2026-08-25', 'name': 'Onam (Thiruvonam)', 'type': 'state', 'description': 'Kerala\'s most important festival, celebrating King Mahabali\'s return.'},
            {'date': '2026-10-29', 'name': 'Diwali', 'type': 'festival', 'description': 'Festival of lights, one of the most important Hindu festivals.'},
        ]
    }

    # Add year-specific holidays if available
    if year in year_specific:
        holidays.extend(year_specific[year])

    # Sort by date
    holidays.sort(key=lambda x: x['date'])

    return holidays

# Start background email checker thread
email_checker_thread = threading.Thread(target=background_email_checker, daemon=True)
email_checker_thread.start()
print("🚀 Background email reminder checker started!")

def extract_subject_from_message(text):
    """Extract subject/course name from message"""
    import re

    # Common subject patterns - using word boundaries to avoid partial matches
    subject_patterns = [
        r'\b(data structures?|ds)\b',
        r'\b(machine learning|ml)\b',
        r'\b(artificial intelligence|ai)\b',
        r'\b(database management|dbms)\b',
        r'\b(operating systems?|os)\b',
        r'\b(computer networks?|cn)\b',
        r'\b(software engineering)\b',  # Removed 'se' to avoid false matches
        r'\b(web development|web dev)\b',
        r'\b(mobile computing|mobile)\b',
        r'\b(cyber security|security)\b',
        r'\b(mathematics|math|maths)\b',
        r'\b(physics|phy)\b',
        r'\b(chemistry|chem)\b',
        r'\b(english|eng)\b',
        r'\b(management|mgmt)\b',
        r'\b(electronics?|electronic)\b',  # Added electronics
        r'\b(data science)\b',  # Added data science
        r'\b(circuit)\b',  # Added circuit
    ]

    text_lower = text.lower()
    for pattern in subject_patterns:
        match = re.search(pattern, text_lower)
        if match:
            return match.group(1).title()

    return None

# Login required decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in') or not session.get('username'):
            print(f"Access denied. Session: {dict(session)}")
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
@login_required
def index():
    print(f"Index accessed by user: {session.get('username', 'Anonymous')}")
    return render_template('index.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    # Prevent redirect loops
    if session.get('logged_in') and session.get('username'):
        print(f"User {session.get('username')} already logged in, redirecting to index")
        return redirect(url_for('index'))
        
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
                
        if not username or not password:
            flash('Username and password are required!', 'error')
            return render_template('login.html')
                
        try:
            user_data = find_user_by_username(username)
            
            if user_data and check_password_hash(user_data.get('password_hash', ''), password):
                # Clear session first
                session.clear()
                                
                # Set session data
                session['username'] = str(username)
                session['student_name'] = str(user_data.get('student_name', username))
                session['role'] = str(user_data.get('role', 'student'))
                session['logged_in'] = True
                                
                print(f"User {username} logged in successfully")
                flash('Login successful!', 'success')
                return redirect(url_for('index'))
            else:
                print(f"Authentication failed for user: {username}")
                flash('Invalid username or password!', 'error')
                            
        except Exception as e:
            print(f"Login error: {e}")
            flash('An error occurred during login. Please try again.', 'error')
                
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    try:
        # Get form data
        student_name = request.form.get('student_name')
        username = request.form.get('username')
        email = request.form.get('email')
        student_id = request.form.get('student_id')
        phone = request.form.get('phone')
        college = request.form.get('college')
        course = request.form.get('course')
        from_year = request.form.get('from_year')
        to_year = request.form.get('to_year')
        password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')
        role = request.form.get('role', 'student')
                
        # Basic validation
        if not all([student_name, username, email, student_id, phone, college, course, from_year, to_year, password, confirm_password]):
            flash('All fields are required!', 'error')
            return render_template('login.html')
                
        if password != confirm_password:
            flash('Passwords do not match!', 'error')
            return render_template('login.html')
                
        if len(password) < 6:
            flash('Password must be at least 6 characters long!', 'error')
            return render_template('login.html')
                
        if int(from_year) >= int(to_year):
            flash('To Year must be after From Year!', 'error')
            return render_template('login.html')
                
        # Check if username already exists
        existing_user = find_user_by_username(username)
        if existing_user:
            flash('Username already exists!', 'error')
            return render_template('login.html')
        
        # Check if email already exists
        existing_email_id, existing_email_user = find_user_by_email(email)
        if existing_email_user:
            flash('Email already registered!', 'error')
            return render_template('login.html')
                
        # Hash password
        password_hash = generate_password_hash(password)
                
        user_data = {
            'user_id': str(uuid.uuid4()),
            'student_name': student_name,
            'username': username,
            'email': email,
            'student_id': student_id,
            'phone': phone,
            'college': college,
            'course': course,
            'from_year': from_year,
            'to_year': to_year,
            'password_hash': password_hash,
            'role': role,
            'created_at': datetime.now().isoformat()
        }
                
        # Create user profile in Firebase
        if create_user_profile(username, user_data):
            flash('Account created successfully! Please login with your credentials.', 'success')
            return redirect(url_for('login'))
        else:
            flash('Error saving user data. Please try again.', 'error')
            return render_template('login.html')
                
    except Exception as e:
        print(f"Registration error: {e}")
        flash('An error occurred during registration. Please try again.', 'error')
        return render_template('login.html')

@app.route('/logout')
def logout():
    username = session.get('username', 'Unknown')
    session.clear()
    print(f"User {username} logged out successfully")
    flash('You have been logged out successfully.', 'success')
    return redirect(url_for('login'))

# Reminder API Routes
@app.route('/api/test', methods=['GET'])
def test_endpoint():
    """Test endpoint to verify server is working"""
    print("DEBUG: Test endpoint called!")
    return jsonify({'status': 'working', 'message': 'Server is responding'})

@app.route('/api/reminders/cleanup-duplicates', methods=['POST'])
@login_required
def cleanup_duplicate_reminders():
    """Clean up existing duplicate reminders"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'Please log in to clean up reminders'}), 401

        # Get existing reminders
        reminders_data = get_user_data(username, 'reminders')
        if 'reminders' in reminders_data:
            original_reminders = reminders_data['reminders']
        else:
            return jsonify({'message': 'No reminders found'}), 200

        # Remove duplicates
        cleaned_reminders = remove_duplicate_reminders(original_reminders)

        # Save cleaned data back to Firebase
        if save_user_data(username, 'reminders', {'reminders': cleaned_reminders}):
            duplicates_removed = len(original_reminders) - len(cleaned_reminders)
            return jsonify({
                'success': True,
                'message': f'Cleanup complete! Removed {duplicates_removed} duplicate reminders.',
                'original_count': len(original_reminders),
                'final_count': len(cleaned_reminders),
                'duplicates_removed': duplicates_removed
            })
        else:
            return jsonify({'error': 'Error saving cleaned reminders'}), 500

    except Exception as e:
        print(f"Error cleaning up duplicates: {e}")
        return jsonify({'error': 'Error cleaning up duplicates'}), 500

@app.route('/api/reminders', methods=['GET'])
@login_required
def get_reminders():
    """Get user's reminders from Firebase"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'Please log in to view reminders'}), 401
        
        print(f"DEBUG: Fetching reminders for username: {username}")

        # Let's check what's actually in Firebase
        try:
            data_ref = get_user_data_ref(username).document('reminders')
            doc = data_ref.get()
            print(f"DEBUG: Document exists: {doc.exists}")
            if doc.exists:
                raw_data = doc.to_dict()
                print(f"DEBUG: Raw document data: {raw_data}")
            else:
                print("DEBUG: No reminders document found")
        except Exception as debug_e:
            print(f"DEBUG: Error checking Firebase: {debug_e}")

        reminders_data = get_user_data(username, 'reminders')
        print(f"DEBUG: Reminders data from get_user_data: {reminders_data}")

        # Fix: The data structure is data.reminders, not just reminders
        if 'reminders' in reminders_data:
            reminders_list = reminders_data['reminders']
        else:
            reminders_list = []
        print(f"DEBUG: Reminders list before deduplication: {len(reminders_list)} items")

        # Remove duplicates
        reminders_list = remove_duplicate_reminders(reminders_list)
        print(f"DEBUG: Reminders list after deduplication: {len(reminders_list)} items")

        # TEMPORARY: Skip date processing to test basic functionality
        print(f"DEBUG: About to return {len(reminders_list)} reminders")
        return jsonify({'reminders': reminders_list})

        # Add enhanced countdown and status to each reminder (DISABLED FOR NOW)
        today = datetime.now()
        for reminder in reminders_list:
            if reminder.get('due_date'):
                due_date = datetime.fromisoformat(reminder['due_date'])
                time_diff = due_date - today
                days_left = (due_date.date() - today.date()).days
                hours_left = time_diff.total_seconds() / 3600

                # Enhanced status and countdown calculation
                if days_left < 0:
                    reminder['status'] = 'overdue'
                    abs_days = abs(days_left)
                    if abs_days == 1:
                        reminder['countdown'] = '1 day overdue'
                    else:
                        reminder['countdown'] = f'{abs_days} days overdue'
                    reminder['priority'] = 'critical'
                elif days_left == 0:
                    # All items due today go to "Due Today" regardless of specific time
                    reminder['status'] = 'due_today'
                    if hours_left < 0:
                        # Past the specific time but still "due today"
                        reminder['countdown'] = 'Due today (time passed)'
                        reminder['priority'] = 'urgent'
                    elif hours_left < 2:
                        reminder['countdown'] = f'Due in {int(hours_left * 60)} minutes!'
                        reminder['priority'] = 'urgent'
                    elif hours_left < 6:
                        reminder['countdown'] = f'Due in {int(hours_left)} hours'
                        reminder['priority'] = 'high'
                    else:
                        reminder['countdown'] = 'Due today!'
                        reminder['priority'] = 'high'
                elif days_left == 1:
                    reminder['status'] = 'due_tomorrow'
                    reminder['countdown'] = 'Due tomorrow'
                    reminder['priority'] = 'medium'
                elif days_left <= 3:
                    reminder['status'] = 'due_soon'
                    reminder['countdown'] = f'{days_left} days left'
                    reminder['priority'] = 'medium'
                elif days_left <= 7:
                    reminder['status'] = 'due_this_week'
                    reminder['countdown'] = f'{days_left} days left'
                    reminder['priority'] = 'low'
                else:
                    reminder['status'] = 'upcoming'
                    if days_left <= 30:
                        reminder['countdown'] = f'{days_left} days left'
                    else:
                        weeks_left = days_left // 7
                        if weeks_left == 1:
                            reminder['countdown'] = '1 week left'
                        elif weeks_left < 4:
                            reminder['countdown'] = f'{weeks_left} weeks left'
                        else:
                            months_left = days_left // 30
                            if months_left == 1:
                                reminder['countdown'] = '1 month left'
                            else:
                                reminder['countdown'] = f'{months_left} months left'
                    reminder['priority'] = 'low'

                # Add formatted due date
                reminder['formatted_due_date'] = due_date.strftime('%B %d, %Y at %I:%M %p')
                reminder['due_date_short'] = due_date.strftime('%m/%d/%Y')

            else:
                reminder['status'] = 'no_date'
                reminder['countdown'] = 'No due date'
                reminder['priority'] = 'low'
                reminder['formatted_due_date'] = None
                reminder['due_date_short'] = None
        
        # Sort by due date
        reminders_list.sort(key=lambda x: x.get('due_date', '9999-12-31'))
        
        return jsonify({'reminders': reminders_list})
            
    except Exception as e:
        print(f"Error retrieving reminders: {e}")
        return jsonify({'error': 'Error retrieving reminders'}), 500

@app.route('/api/reminders', methods=['POST'])
@login_required
def save_reminder():
    """Save a new reminder"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'Please log in to save reminders'}), 401
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Get existing reminders
        reminders_data = get_user_data(username, 'reminders')
        if 'reminders' in reminders_data:
            reminders_list = reminders_data['reminders']
        else:
            reminders_list = []

        # Create new reminder
        new_reminder = {
            'id': str(uuid.uuid4()),
            'title': data.get('title', ''),
            'description': data.get('description', ''),
            'type': data.get('type', 'assignment'),
            'due_date': data.get('due_date'),
            'created_at': datetime.now().isoformat(),
            'completed': False
        }

        # Check for duplicates
        if is_duplicate_reminder(new_reminder, reminders_list):
            return jsonify({
                'error': 'Duplicate reminder detected',
                'message': f'A reminder with the same title "{new_reminder["title"]}", type "{new_reminder["type"]}", and due date already exists.'
            }), 400

        reminders_list.append(new_reminder)
        
        # Save back to Firebase
        if save_user_data(username, 'reminders', {'reminders': reminders_list}):
            return jsonify({'success': True, 'reminder': new_reminder})
        else:
            return jsonify({'error': 'Error saving reminder'}), 500
        
    except Exception as e:
        print(f"Error saving reminder: {e}")
        return jsonify({'error': 'Error saving reminder'}), 500

@app.route('/api/reminders/fix-times', methods=['POST'])
def fix_reminder_times():
    """Fix existing reminder times by re-parsing their descriptions"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'Not authenticated'}), 401

        # Get current reminders
        user_data = get_user_data(username, 'reminders')
        if not user_data:
            return jsonify({'error': 'No reminders found'}), 404

        reminders_list = user_data.get('reminders', [])
        updated_count = 0

        for reminder in reminders_list:
            description = reminder.get('description', '')
            current_due_date = reminder.get('due_date')

            print(f"DEBUG: Processing reminder '{reminder.get('title', 'Unknown')}' with description: {description[:100]}...")
            print(f"DEBUG: Current due_date: {current_due_date}")

            if description and current_due_date:
                # Parse time from description
                parsed_date = parse_date_from_text(description)
                print(f"DEBUG: Parsed date from description: {parsed_date}")

                if parsed_date:
                    # Handle different date formats that might already exist
                    try:
                        # Clean up the date string to handle various formats
                        date_str = current_due_date

                        # Remove trailing Z first
                        if date_str.endswith('Z'):
                            date_str = date_str[:-1]

                        # Clean up corrupted dates with double timezone suffixes
                        import re

                        # Fix dates with timezone + Z like +00:00Z
                        if '+00:00Z' in date_str:
                            date_str = date_str.replace('+00:00Z', 'Z')

                        # Fix dates with double timezone suffixes like +00:00+00:00
                        double_tz_pattern = r'(\+\d{2}:\d{2})\+\d{2}:\d{2}$'
                        if re.search(double_tz_pattern, date_str):
                            # Remove the duplicate timezone suffix
                            date_str = re.sub(double_tz_pattern, r'\1', date_str)

                        # Check if it already has timezone info at the end
                        # Look for patterns like +00:00, -05:00, etc. at the end
                        timezone_pattern = r'[+-]\d{2}:\d{2}$'

                        if not re.search(timezone_pattern, date_str):
                            # Only add timezone if it doesn't already have one
                            date_str += '+00:00'

                        old_due_date = datetime.fromisoformat(date_str)
                    except ValueError:
                        # If parsing fails, skip this reminder
                        continue

                    # Keep the same date but update the time
                    new_due_date = old_due_date.replace(
                        hour=parsed_date.hour,
                        minute=parsed_date.minute,
                        second=0,
                        microsecond=0
                    )

                    reminder['due_date'] = new_due_date.isoformat() + 'Z'
                    reminder['updated_at'] = datetime.now().isoformat()
                    updated_count += 1

        # Save updated reminders
        if updated_count > 0:
            if save_user_data(username, 'reminders', {'reminders': reminders_list}):
                return jsonify({
                    'success': True,
                    'message': f'Updated {updated_count} reminders with correct times',
                    'updated_count': updated_count
                })
            else:
                return jsonify({'error': 'Error saving updated reminders'}), 500
        else:
            return jsonify({'message': 'No reminders needed time updates'})

    except Exception as e:
        print(f"Error fixing reminder times: {e}")
        return jsonify({'error': 'Error fixing reminder times'}), 500

@app.route('/api/reminders/parse', methods=['POST'])
def parse_message():
    """Parse message text to extract reminder information"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        message_text = data.get('message', '')
        if not message_text:
            return jsonify({'error': 'No message text provided'}), 400

        # Simplified parsing for debugging
        try:
            reminder_type = classify_reminder_type(message_text)
        except Exception as e:
            return jsonify({'error': f'Error in classify_reminder_type: {str(e)}'}), 500

        try:
            due_date = parse_date_from_text(message_text)
        except Exception as e:
            return jsonify({'error': f'Error in parse_date_from_text: {str(e)}'}), 500

        try:
            title = extract_title_from_message(message_text, reminder_type)
            print(f"🔍 DEBUG: Final title extracted: '{title}' for type: '{reminder_type}' from message: '{message_text}'")
        except Exception as e:
            print(f"❌ ERROR in extract_title_from_message: {str(e)}")
            return jsonify({'error': f'Error in extract_title_from_message: {str(e)}'}), 500

        try:
            subject = extract_subject_from_message(message_text)
        except Exception as e:
            return jsonify({'error': f'Error in extract_subject_from_message: {str(e)}'}), 500

        # Create enhanced description
        description = message_text
        if subject:
            description = f"Subject: {subject}\n\n{message_text}"

        result = {
            'title': title,
            'description': description,
            'type': reminder_type,
            'subject': subject,
            'due_date': due_date.isoformat() if due_date else None,
            'parsed_date': due_date.strftime('%Y-%m-%d') if due_date else None,
            'parsed_time': due_date.strftime('%H:%M') if due_date else None,
            'confidence': {
                'type_confidence': 'high' if any(keyword in message_text.lower() for keyword in [reminder_type, 'exam', 'assignment', 'project']) else 'medium',
                'date_confidence': 'high' if due_date else 'low'
            }
        }
        
        return jsonify(result)
        
    except Exception as e:
        print(f"Error parsing message: {e}")
        return jsonify({'error': 'Error parsing message'}), 500

@app.route('/api/reminders/<reminder_id>', methods=['PUT'])
@login_required
def update_reminder(reminder_id):
    """Update a reminder"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'Please log in to update reminders'}), 401
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Get existing reminders
        reminders_data = get_user_data(username, 'reminders')
        if 'reminders' in reminders_data:
            reminders_list = reminders_data['reminders']
        else:
            reminders_list = []
        
        # Find and update reminder
        for reminder in reminders_list:
            if reminder['id'] == reminder_id:
                reminder.update({
                    'title': data.get('title', reminder['title']),
                    'description': data.get('description', reminder['description']),
                    'type': data.get('type', reminder['type']),
                    'due_date': data.get('due_date', reminder['due_date']),
                    'due_time': data.get('due_time', reminder.get('due_time')),
                    'completed': data.get('completed', reminder['completed']),
                    'updated_at': datetime.now().isoformat()
                })
                
                # Save back to Firebase
                if save_user_data(username, 'reminders', {'reminders': reminders_list}):
                    return jsonify({'success': True, 'reminder': reminder})
                else:
                    return jsonify({'error': 'Error updating reminder'}), 500
        
        return jsonify({'error': 'Reminder not found'}), 404
        
    except Exception as e:
        print(f"Error updating reminder: {e}")
        return jsonify({'error': 'Error updating reminder'}), 500

@app.route('/api/reminders/<reminder_id>', methods=['DELETE'])
@login_required
def delete_reminder(reminder_id):
    """Delete a reminder"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'Please log in to delete reminders'}), 401
        
        # Get existing reminders
        reminders_data = get_user_data(username, 'reminders')
        if 'reminders' in reminders_data:
            reminders_list = reminders_data['reminders']
        else:
            reminders_list = []
        
        # Find and remove reminder
        reminders_list = [r for r in reminders_list if r['id'] != reminder_id]
        
        # Save back to Firebase
        if save_user_data(username, 'reminders', {'reminders': reminders_list}):
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Error deleting reminder'}), 500
        
    except Exception as e:
        print(f"Error deleting reminder: {e}")
        return jsonify({'error': 'Error deleting reminder'}), 500

@app.route('/api/reminders/email-settings', methods=['GET', 'POST'])
@login_required
def email_settings():
    """Get or update email notification settings"""
    print(f"🔥 EMAIL SETTINGS ENDPOINT CALLED - Method: {request.method}")
    try:
        username = session.get('username')
        print(f"🔥 Username from session: {username}")
        if not username:
            print("🔥 No username in session")
            return jsonify({'error': 'User not found in session'}), 401

        if request.method == 'GET':
            # Get current email settings
            user_data = get_user_data(username, 'email_settings')

            # Get user's registration email
            user_profile = find_user_by_username(username)
            user_email = user_profile.get('email', '') if user_profile else ''

            settings = user_data.get('settings', {
                'enabled': False,
                'notify_24h': True,
                'notify_1h': True,
                'notify_overdue': True,
                'email': user_email  # Use registration email
            })

            # Always use the registration email (override any stored email)
            settings['email'] = user_email
            return jsonify({'settings': settings})

        elif request.method == 'POST':
            # Update email settings
            data = request.get_json()
            if not data:
                return jsonify({'error': 'No data provided'}), 400

            # Get user's registration email (always use this, ignore any email from frontend)
            user_profile = find_user_by_username(username)
            user_email = user_profile.get('email', '') if user_profile else ''

            settings = {
                'enabled': data.get('enabled', False),
                'notify_24h': data.get('notify_24h', True),
                'notify_1h': data.get('notify_1h', True),
                'notify_overdue': data.get('notify_overdue', True),
                'email': user_email,  # Always use registration email
                'updated_at': datetime.now().isoformat()
            }

            if save_user_data(username, 'email_settings', {'settings': settings}):
                return jsonify({'success': True, 'settings': settings})
            else:
                return jsonify({'error': 'Error saving email settings'}), 500

    except Exception as e:
        print(f"Error handling email settings: {e}")
        return jsonify({'error': 'Error handling email settings'}), 500

@app.route('/api/reminders/send-test-email', methods=['POST'])
@login_required
def send_test_email():
    """Send a test email reminder"""
    print("🔥 TEST EMAIL ENDPOINT CALLED!")
    try:
        username = session.get('username')
        print(f"🔥 Username from session: {username}")
        if not username:
            print("🔥 No username in session")
            return jsonify({'error': 'User not found in session'}), 401

        # Get user's registration email
        user_profile = find_user_by_username(username)
        if not user_profile or not user_profile.get('email'):
            return jsonify({'error': 'No email address found in your profile'}), 400

        user_email = user_profile.get('email')

        # Create test reminder data
        test_reminder = {
            'title': 'Test Reminder',
            'type': 'assignment',
            'description': 'This is a test email from the Smart Student Reminder System.',
            'formatted_due_date': 'Tomorrow at 11:59 PM',
            'countdown': 'Due in 1 day'
        }

        # Send test email to user's registration email
        if send_email_reminder(user_email, test_reminder):
            return jsonify({'success': True, 'message': f'Test email sent successfully to {user_email}!'})
        else:
            return jsonify({'error': 'Failed to send test email. Check email configuration.'}), 500

    except Exception as e:
        print(f"Error sending test email: {e}")
        return jsonify({'error': 'Error sending test email'}), 500

@app.route('/api/reminders/check-email-notifications', methods=['POST'])
@login_required
def manual_email_check():
    """Manually trigger email notification check"""
    try:
        print("🔔 Manual email notification check triggered!")
        notifications_sent = check_and_send_email_reminders()
        return jsonify({
            'success': True,
            'message': f'Email check completed. Sent {notifications_sent} notifications.',
            'notifications_sent': notifications_sent
        })
    except Exception as e:
        print(f"Error in manual email check: {e}")
        return jsonify({'error': 'Error checking email notifications'}), 500

@app.route('/api/reminders/fix-major-time', methods=['POST', 'GET'])
@login_required
def fix_major_reminder_time():
    """Fix the MAJOR reminder time from 4:30 PM to 11:00 AM"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not logged in'}), 401

        # Get user's reminders
        reminders_data = get_user_data(username, 'reminders')
        if not reminders_data or 'reminders' not in reminders_data:
            return jsonify({'error': 'No reminders found'}), 404

        reminders = reminders_data['reminders']

        # Find and fix the MAJOR reminder
        fixed = False
        for reminder in reminders:
            if reminder.get('title') == 'MAJOR':
                # Parse the current due date
                current_due_str = reminder.get('due_date', '')
                if current_due_str:
                    try:
                        # Parse current date
                        current_due = datetime.fromisoformat(current_due_str.replace('Z', ''))
                        # Change time to 11:00 AM
                        new_due = current_due.replace(hour=11, minute=0, second=0, microsecond=0)
                        # Update the reminder
                        reminder['due_date'] = new_due.isoformat()
                        fixed = True
                        print(f"🔧 Fixed MAJOR reminder time: {current_due} -> {new_due}")
                        break
                    except Exception as e:
                        print(f"Error parsing date: {e}")
                        return jsonify({'error': f'Error parsing date: {e}'}), 500

        if fixed:
            # Save updated reminders
            save_user_data(username, 'reminders', {'reminders': reminders})

            # Clear the sent notifications for MAJOR so it can send again at correct time
            sent_notifications_data = get_user_data(username, 'sent_notifications')
            if sent_notifications_data and 'notifications' in sent_notifications_data:
                sent_list = sent_notifications_data['notifications']
                # Remove MAJOR notifications
                sent_list = [notif for notif in sent_list if 'MAJOR' not in notif]
                save_user_data(username, 'sent_notifications', {'notifications': sent_list})
                print("🧹 Cleared MAJOR notification history")

            return jsonify({
                'success': True,
                'message': 'MAJOR reminder time fixed to 11:00 AM and notification history cleared'
            })
        else:
            return jsonify({'error': 'MAJOR reminder not found'}), 404

    except Exception as e:
        print(f"Error fixing MAJOR reminder: {e}")
        return jsonify({'error': 'Error fixing reminder time'}), 500

@app.route('/api/reminders/clear-notifications', methods=['POST', 'GET'])
@login_required
def clear_all_notifications():
    """Clear all sent notification history"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not logged in'}), 401

        # Clear all sent notifications
        save_user_data(username, 'sent_notifications', {'notifications': []})
        print(f"🧹 Cleared all notification history for user: {username}")

        return jsonify({
            'success': True,
            'message': 'All notification history cleared. Email notifications can now be sent again.'
        })

    except Exception as e:
        print(f"Error clearing notifications: {e}")
        return jsonify({'error': 'Error clearing notification history'}), 500

# Timetable API Routes
@app.route('/api/timetable', methods=['GET'])
@login_required
def get_timetable():
    """Get user's timetable from Firebase"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not found in session'}), 401
        
        timetable_data = get_user_data(username, 'timetable')
        return jsonify({'timetable': timetable_data})
            
    except Exception as e:
        print(f"Error retrieving timetable: {e}")
        return jsonify({'error': 'Error retrieving timetable'}), 500

@app.route('/api/timetable', methods=['POST'])
@login_required
def save_timetable():
    """Save user's timetable to Firebase"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not found in session'}), 401
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        timetable_data = data.get('timetable', {})
        
        if save_user_data(username, 'timetable', timetable_data):
            return jsonify({'success': True, 'message': 'Timetable saved successfully'})
        else:
            return jsonify({'error': 'Error saving timetable'}), 500
        
    except Exception as e:
        print(f"Error saving timetable: {e}")
        return jsonify({'error': 'Error saving timetable'}), 500

# CGPA API Routes
@app.route('/api/calculate_cgpa', methods=['POST'])
@login_required
def calculate_cgpa():
    try:
        username = session.get('username')
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
                    
        semesters = data.get('semesters', [])
        scale = data.get('scale', 10)  # Default to 10-point scale

        if not semesters:
            return jsonify({'error': 'No semester data provided'}), 400

        total_credits = 0
        total_grade_points = 0
        semester_results = []

        for i, semester in enumerate(semesters):
            sgpa = float(semester.get('sgpa', 0))
            credits = float(semester.get('credits', 0))

            if sgpa > 0 and credits > 0:
                grade_points = sgpa * credits
                total_credits += credits
                total_grade_points += grade_points

                semester_results.append({
                    'semester': f"Semester {i + 1}",
                    'sgpa': sgpa,
                    'credits': credits,
                    'grade_points': grade_points
                })

        if total_credits == 0:
            return jsonify({'error': 'No valid semester data found'}), 400

        cgpa = total_grade_points / total_credits

        # Calculate conversions based on the selected scale
        if scale == 10:
            # 10-point scale (Indian system)
            gpa_4_scale = max(0, ((cgpa - 5) * 4) / 5)  # Convert 10-point to 4-point
            gpa_5_scale = cgpa / 2  # Convert 10-point to 5-point
            percentage = (cgpa - 0.75) * 10  # CGPA to percentage conversion
        elif scale == 5:
            # 5-point scale (German system) - lower is better
            gpa_4_scale = (6 - cgpa) * 4 / 5  # Convert 5-point to 4-point
            gpa_10_scale = (6 - cgpa) * 2  # Convert 5-point to 10-point
            percentage = max(0, (6 - cgpa) * 20)  # Approximate percentage
        elif scale == 4:
            # 4-point scale (US GPA)
            gpa_10_scale = (cgpa * 5) + 5  # Convert 4-point to 10-point
            gpa_5_scale = (4 - cgpa) + 1  # Convert 4-point to 5-point (German)
            percentage = (cgpa / 4) * 100  # GPA to percentage
                
        # Build result based on scale
        result = {
            'cgpa': round(cgpa, 2),
            'scale': scale,
            'total_credits': total_credits,
            'total_grade_points': round(total_grade_points, 2),
            'semesters': semester_results,
            'calculated_at': datetime.now().isoformat()
        }

        # Add conversions based on scale
        if scale == 10:
            result.update({
                'gpa_4_scale': round(gpa_4_scale, 2),
                'gpa_5_scale': round(gpa_5_scale, 2),
                'percentage': round(percentage, 1)
            })
        elif scale == 5:
            result.update({
                'gpa_4_scale': round(gpa_4_scale, 2),
                'gpa_10_scale': round(gpa_10_scale, 2),
                'percentage': round(percentage, 1)
            })
        elif scale == 4:
            result.update({
                'gpa_10_scale': round(gpa_10_scale, 2),
                'gpa_5_scale': round(gpa_5_scale, 2),
                'percentage': round(percentage, 1)
            })
                
        # Save calculation to Firebase
        add_user_calculation(username, 'cgpa', result)
                
        return jsonify(result)
            
    except Exception as e:
        print(f"CGPA calculation error: {e}")
        return jsonify({'error': 'Error calculating CGPA'}), 500

@app.route('/api/calculate_attendance', methods=['POST'])
@login_required
def calculate_attendance():
    try:
        username = session.get('username')
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
                    
        attended = int(data.get('attended', 0))
        total = int(data.get('total', 0))
        min_required = float(data.get('min_required', 75))
        subject_name = data.get('subject_name', 'Subject')
                
        if total <= 0:
            return jsonify({'error': 'Total classes must be greater than 0'}), 400
                
        if attended > total:
            return jsonify({'error': 'Attended classes cannot exceed total classes'}), 400
                
        current_percent = (attended / total) * 100
                
        # Calculate future requirements
        future_classes = 0
        can_skip = 0
                
        if current_percent < min_required:
            # Calculate classes needed
            while True:
                future_total = total + future_classes
                future_attended = attended + future_classes
                future_percent = (future_attended / future_total) * 100
                                
                if future_percent >= min_required:
                    break
                future_classes += 1
        else:
            # Calculate classes that can be skipped
            temp_total = total
            while True:
                temp_total += 1
                if (attended / temp_total) * 100 >= min_required:
                    can_skip += 1
                else:
                    break
                
        status = 'safe' if current_percent >= min_required else 'at_risk'
        message = f"Your attendance is {'above' if status == 'safe' else 'below'} the required {min_required}%"
                
        if status == 'safe':
            recommendation = f"You can skip up to {can_skip} classes and still maintain {min_required}% attendance." if can_skip > 0 else "Keep maintaining your good attendance!"
        else:
            recommendation = f"You need to attend the next {future_classes} classes consecutively to reach {min_required}% attendance."
                
        result = {
            'current_percent': round(current_percent, 2),
            'attended': attended,
            'total': total,
            'min_required': min_required,
            'status': status,
            'message': message,
            'recommendation': recommendation,
            'future_classes': future_classes,
            'can_skip': can_skip,
            'subject_name': subject_name,
            'calculated_at': datetime.now().isoformat()
        }
                
        # Save calculation to Firebase
        add_user_calculation(username, 'attendance', result)
                
        return jsonify(result)
            
    except Exception as e:
        print(f"Attendance calculation error: {e}")
        return jsonify({'error': 'Error calculating attendance'}), 500

@app.route('/api/holidays')
@login_required
def get_holidays():
    try:
        year = request.args.get('year', datetime.now().year, type=int)
        month = request.args.get('month')
        holiday_type = request.args.get('type')
        search = request.args.get('search', '').lower()

        # Generate holidays dynamically for the requested year
        holidays_list = generate_indian_holidays(year)
                
        # Apply filters
        if month:
            holidays_list = [h for h in holidays_list if datetime.strptime(h['date'], '%Y-%m-%d').month == int(month)]
                
        if holiday_type:
            holidays_list = [h for h in holidays_list if h['type'] == holiday_type]
                
        if search:
            holidays_list = [h for h in holidays_list if search in h['name'].lower() or search in h['description'].lower()]
                
        # Add status and countdown
        today = datetime.now().date()
        for holiday in holidays_list:
            holiday_date = datetime.strptime(holiday['date'], '%Y-%m-%d').date()
                        
            if holiday_date == today:
                holiday['status'] = 'today'
                holiday['countdown'] = 'Today!'
            elif holiday_date < today:
                holiday['status'] = 'past'
                holiday['countdown'] = ''
            else:
                holiday['status'] = 'upcoming'
                diff_days = (holiday_date - today).days
                holiday['countdown'] = 'Tomorrow' if diff_days == 1 else f'In {diff_days} days'
                
        return jsonify(holidays_list)
            
    except Exception as e:
        print(f"Holidays error: {e}")
        return jsonify({'error': 'Error fetching holidays'}), 500

@app.route('/api/calendar')
@login_required
def get_calendar():
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not logged in'}), 401

        year = request.args.get('year', datetime.now().year, type=int)
        month = request.args.get('month')
        view = request.args.get('view', 'events')  # events, holidays, personal

        calendar_items = []

        # Add holidays if requested
        if view in ['events', 'holidays']:
            holidays_list = generate_indian_holidays(year)

            # Apply month filter
            if month:
                holidays_list = [h for h in holidays_list if datetime.strptime(h['date'], '%Y-%m-%d').month == int(month)]

            # Add holidays to calendar items
            for holiday in holidays_list:
                calendar_items.append({
                    'id': f"holiday_{holiday['date']}",
                    'name': holiday['name'],
                    'description': holiday['description'],
                    'date': holiday['date'],
                    'type': holiday['type'],
                    'category': 'holiday'
                })

        # Add personal events if requested
        if view in ['events', 'personal']:
            events_data = get_user_data(username, 'calendar_events')
            if events_data and 'events' in events_data:
                user_events = events_data['events']

                # Apply filters
                for event in user_events:
                    event_date = datetime.strptime(event['date'], '%Y-%m-%d')
                    if event_date.year == year:
                        if not month or event_date.month == int(month):
                            calendar_items.append({
                                'id': event['id'],
                                'title': event['title'],
                                'name': event['title'],  # For compatibility
                                'description': event.get('description', ''),
                                'date': event['date'],
                                'time': event.get('time'),
                                'type': 'event',
                                'event_type': event.get('type', 'personal'),
                                'color': event.get('color', 'blue'),
                                'category': 'event'
                            })

        # Sort by date
        calendar_items.sort(key=lambda x: x['date'])

        # Add status and countdown
        today = datetime.now().date()
        for item in calendar_items:
            item_date = datetime.strptime(item['date'], '%Y-%m-%d').date()

            if item_date == today:
                item['status'] = 'today'
                item['countdown'] = 'Today!'
            elif item_date < today:
                item['status'] = 'past'
                item['countdown'] = ''
            else:
                item['status'] = 'upcoming'
                diff_days = (item_date - today).days
                item['countdown'] = 'Tomorrow' if diff_days == 1 else f'In {diff_days} days'

        return jsonify(calendar_items)

    except Exception as e:
        print(f"Calendar error: {e}")
        return jsonify({'error': 'Error fetching calendar'}), 500

@app.route('/api/calendar/events', methods=['GET'])
@login_required
def get_calendar_events():
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not logged in'}), 401

        # Get user's events
        events_data = get_user_data(username, 'calendar_events')
        events_list = events_data.get('events', []) if events_data else []

        return jsonify(events_list)

    except Exception as e:
        print(f"Error getting calendar events: {e}")
        return jsonify({'error': 'Error getting events'}), 500

@app.route('/api/calendar/events', methods=['POST'])
@login_required
def add_calendar_event():
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not logged in'}), 401

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        # Validate required fields
        if not data.get('title') or not data.get('date'):
            return jsonify({'error': 'Title and date are required'}), 400

        # Create event object
        event = {
            'id': str(uuid.uuid4()),
            'title': data['title'],
            'date': data['date'],
            'time': data.get('time'),
            'type': data.get('type', 'personal'),
            'description': data.get('description', ''),
            'color': data.get('color', 'blue'),
            'created_at': datetime.now().isoformat()
        }

        # Get existing events
        events_data = get_user_data(username, 'calendar_events')
        events_list = events_data.get('events', []) if events_data else []

        # Add new event
        events_list.append(event)

        # Save events
        save_user_data(username, 'calendar_events', {'events': events_list})

        return jsonify({'success': True, 'event': event})

    except Exception as e:
        print(f"Error adding calendar event: {e}")
        return jsonify({'error': 'Error adding event'}), 500

@app.route('/api/calendar/events/<event_id>', methods=['PUT'])
@login_required
def update_calendar_event(event_id):
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not logged in'}), 401

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        # Validate required fields
        if not data.get('title') or not data.get('date'):
            return jsonify({'error': 'Title and date are required'}), 400

        # Get existing events
        events_data = get_user_data(username, 'calendar_events')
        if not events_data or 'events' not in events_data:
            return jsonify({'error': 'No events found'}), 404

        events_list = events_data['events']

        # Find and update event
        event_found = False
        for event in events_list:
            if event['id'] == event_id:
                event.update({
                    'title': data['title'],
                    'date': data['date'],
                    'time': data.get('time'),
                    'type': data.get('type', 'personal'),
                    'description': data.get('description', ''),
                    'color': data.get('color', 'blue'),
                    'updated_at': datetime.now().isoformat()
                })
                event_found = True
                break

        if not event_found:
            return jsonify({'error': 'Event not found'}), 404

        # Save updated events
        save_user_data(username, 'calendar_events', {'events': events_list})

        return jsonify({'success': True, 'message': 'Event updated successfully'})

    except Exception as e:
        print(f"Error updating calendar event: {e}")
        return jsonify({'error': 'Error updating event'}), 500

@app.route('/api/calendar/events/<event_id>', methods=['DELETE'])
@login_required
def delete_calendar_event(event_id):
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not logged in'}), 401

        # Get existing events
        events_data = get_user_data(username, 'calendar_events')
        if not events_data or 'events' not in events_data:
            return jsonify({'error': 'No events found'}), 404

        events_list = events_data['events']

        # Find and remove event
        events_list = [event for event in events_list if event['id'] != event_id]

        # Save updated events
        save_user_data(username, 'calendar_events', {'events': events_list})

        return jsonify({'success': True, 'message': 'Event deleted successfully'})

    except Exception as e:
        print(f"Error deleting calendar event: {e}")
        return jsonify({'error': 'Error deleting event'}), 500

@app.route('/api/history')
@login_required
def get_history():
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not found in session'}), 401
        
        calculations = get_user_data(username, 'calculations')
        if not calculations:
            calculations = {'cgpa': [], 'attendance': []}
                
        # Return last 10 records for each type
        user_cgpa = calculations.get('cgpa', [])[-10:]
        user_attendance = calculations.get('attendance', [])[-10:]
                
        return jsonify({
            'cgpa': user_cgpa,
            'attendance': user_attendance
        })
            
    except Exception as e:
        print(f"History error: {e}")
        return jsonify({'error': 'Error fetching history', 'details': str(e)}), 500

@app.route('/api/delete_cgpa_record', methods=['DELETE'])
@login_required
def delete_cgpa_record():
    """Delete a specific CGPA calculation record"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not found in session'}), 401

        data = request.get_json()
        if not data or 'timestamp' not in data:
            return jsonify({'error': 'Timestamp is required'}), 400

        timestamp = data['timestamp']

        # Get existing calculations
        calculations = get_user_data(username, 'calculations')
        if not calculations:
            return jsonify({'error': 'No calculations found'}), 404

        # Filter out the record with matching timestamp
        cgpa_records = calculations.get('cgpa', [])
        updated_cgpa = [record for record in cgpa_records if record.get('timestamp') != timestamp]

        # Check if any record was actually removed
        if len(updated_cgpa) == len(cgpa_records):
            return jsonify({'error': 'Record not found'}), 404

        # Update calculations
        calculations['cgpa'] = updated_cgpa

        # Save back to Firebase
        if save_user_data(username, 'calculations', calculations):
            return jsonify({'success': True, 'message': 'CGPA record deleted successfully'})
        else:
            return jsonify({'error': 'Error saving updated calculations'}), 500

    except Exception as e:
        print(f"Delete CGPA record error: {e}")
        return jsonify({'error': 'Error deleting CGPA record', 'details': str(e)}), 500

@app.route('/api/delete_attendance_record', methods=['DELETE'])
@login_required
def delete_attendance_record():
    """Delete a specific attendance record"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not found in session'}), 401

        data = request.get_json()
        if not data or 'timestamp' not in data:
            return jsonify({'error': 'Timestamp is required'}), 400

        timestamp = data['timestamp']

        # Get existing calculations
        calculations = get_user_data(username, 'calculations')
        if not calculations:
            return jsonify({'error': 'No calculations found'}), 404

        # Filter out the record with matching timestamp
        attendance_records = calculations.get('attendance', [])
        updated_attendance = [record for record in attendance_records if record.get('timestamp') != timestamp]

        # Check if any record was actually removed
        if len(updated_attendance) == len(attendance_records):
            return jsonify({'error': 'Record not found'}), 404

        # Update calculations
        calculations['attendance'] = updated_attendance

        # Save back to Firebase
        if save_user_data(username, 'calculations', calculations):
            return jsonify({'success': True, 'message': 'Attendance record deleted successfully'})
        else:
            return jsonify({'error': 'Error saving updated calculations'}), 500

    except Exception as e:
        print(f"Delete attendance record error: {e}")
        return jsonify({'error': 'Error deleting attendance record', 'details': str(e)}), 500

# Health check route
@app.route('/health')
def health_check():
    return jsonify({
        'status': 'ok', 
        'message': 'Server is running with Firebase storage and Smart Reminder System',
        'environment': os.getenv('FLASK_ENV', 'development'),
        'firebase_configured': db is not None
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
