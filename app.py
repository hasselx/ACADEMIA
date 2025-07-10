from flask import Flask, render_template, request, jsonify, redirect, url_for, flash, session
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timedelta
import json
import os
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import uuid
from dotenv import load_dotenv
app = Flask(__name__)
app.secret_key = 'your-secret-key-change-this-in-production'

load_dotenv()  # Loads .env variables into environment

# Session configuration
app.config['SESSION_PERMANENT'] = False
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = False  # Set to True in production with HTTPS
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Initialize Firebase (REQUIRED - no local storage fallback)
db = None
firebase_config = {
    "type": os.getenv("FIREBASE_TYPE"),
    "project_id": os.getenv("FIREBASE_PROJECT_ID"),
    "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
    "private_key": os.getenv("FIREBASE_PRIVATE_KEY").replace("\\n", "\n"),
    "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
    "client_id": os.getenv("FIREBASE_CLIENT_ID"),
    "auth_uri": os.getenv("FIREBASE_AUTH_URI"),
    "token_uri": os.getenv("FIREBASE_TOKEN_URI"),
    "auth_provider_x509_cert_url": os.getenv("FIREBASE_AUTH_PROVIDER_CERT_URL"),
    "client_x509_cert_url": os.getenv("FIREBASE_CLIENT_CERT_URL"),
    "universe_domain": os.getenv("FIREBASE_UNIVERSE_DOMAIN")
}


cred = credentials.Certificate(firebase_config)
firebase_admin.initialize_app(cred)

def get_user_profile_ref(username):
    """Get Firebase reference for user profile"""
    return db.collection('users').document('students').collection('profiles').document(username)

def get_user_data_ref(username):
    """Get Firebase reference for user data (cgpa, attendance, timetable)"""
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
    """Save user data (cgpa, attendance, timetable) to Firebase"""
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
    """Get user data (cgpa, attendance, timetable) from Firebase"""
    try:
        data_ref = get_user_data_ref(username).document(data_type)
        doc = data_ref.get()
        if doc.exists:
            return doc.to_dict().get('data', {})
        return {}
    except Exception as e:
        print(f"Error getting {data_type} data for {username}: {e}")
        return {}

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
    print(f"Index accessed by user: {session.get('username', 'Unknown')}")
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

@app.route('/api/timetable/day/<day>', methods=['GET'])
@login_required
def get_day_timetable(day):
    """Get timetable for a specific day"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'error': 'User not found in session'}), 401
        
        timetable_data = get_user_data(username, 'timetable')
        day_schedule = timetable_data.get(day.lower(), [])
        return jsonify({'day': day, 'schedule': day_schedule})
            
    except Exception as e:
        print(f"Error retrieving day timetable: {e}")
        return jsonify({'error': 'Error retrieving day timetable'}), 500

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
        gpa_4_scale = max(0, ((cgpa - 5) * 4) / 5)
        gpa_5_scale = cgpa / 2
                
        result = {
            'cgpa': round(cgpa, 2),
            'gpa_4_scale': round(gpa_4_scale, 2),
            'gpa_5_scale': round(gpa_5_scale, 2),
            'total_credits': total_credits,
            'total_grade_points': round(total_grade_points, 2),
            'semesters': semester_results,
            'calculated_at': datetime.now().isoformat()
        }
                
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
                
        # Kerala holidays for 2025
        kerala_holidays_2025 = [
            {'date': '2025-01-01', 'name': "New Year's Day", 'type': 'national', 'description': 'The first day of the Gregorian calendar year, celebrated worldwide.'},
            {'date': '2025-01-14', 'name': 'Makar Sankranti', 'type': 'religious', 'description': 'Hindu festival marking the transition of the sun into Capricorn.'},
            {'date': '2025-01-26', 'name': 'Republic Day', 'type': 'national', 'description': 'Commemorates the adoption of the Constitution of India.'},
            {'date': '2025-02-26', 'name': 'Maha Shivratri', 'type': 'religious', 'description': 'Hindu festival dedicated to Lord Shiva.'},
            {'date': '2025-03-13', 'name': 'Holi', 'type': 'festival', 'description': 'Festival of colors, celebrating the arrival of spring.'},
            {'date': '2025-04-13', 'name': 'Vishu', 'type': 'state', 'description': 'Malayalam New Year, celebrated with traditional rituals and feasts.'},
            {'date': '2025-05-01', 'name': 'Labour Day', 'type': 'national', 'description': 'International Workers Day, celebrating laborers and the working class.'},
            {'date': '2025-08-15', 'name': 'Independence Day', 'type': 'national', 'description': 'Commemorates Indias independence from British rule in 1947.'},
            {'date': '2025-09-05', 'name': 'Onam (Thiruvonam)', 'type': 'state', 'description': 'Keralas most important festival, celebrating King Mahabalis return.'},
            {'date': '2025-10-02', 'name': 'Gandhi Jayanti', 'type': 'national', 'description': 'Birthday of Mahatma Gandhi, the Father of the Nation.'},
            {'date': '2025-11-09', 'name': 'Diwali', 'type': 'festival', 'description': 'Festival of lights, one of the most important Hindu festivals.'},
            {'date': '2025-12-25', 'name': 'Christmas Day', 'type': 'religious', 'description': 'Christian festival celebrating the birth of Jesus Christ.'},
        ]
                
        holidays_list = kerala_holidays_2025
                
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

# Admin route to view all users
@app.route('/admin/users')
@login_required
def admin_users():
    """Admin route to view all users"""
    try:
        users_ref = db.collection('users').document('students').collection('profiles')
        docs = users_ref.order_by('username').get()
        
        users_list = []
        for doc in docs:
            user_data = doc.to_dict()
            user_data['id'] = doc.id
            # Remove password for security
            user_data.pop('password_hash', None)
            users_list.append(user_data)
        
        return jsonify({
            'total_users': len(users_list),
            'users': [{
                'username': user.get('username'),
                'student_name': user.get('student_name'),
                'email': user.get('email'),
                'college': user.get('college'),
                'course': user.get('course'),
                'role': user.get('role', 'student'),
                'created_at': user.get('created_at')
            } for user in users_list]
        })
    except Exception as e:
        print(f"Error retrieving users: {e}")
        return jsonify({'error': 'Error retrieving users'}), 500

# Health check route
@app.route('/health')
def health_check():
    return jsonify({'status': 'ok', 'message': 'Server is running with Firebase-only storage'})

if __name__ == '__main__':
    print("Starting Flask server with Firebase-only storage...")
    print("Firebase structure: /users/students/profiles/username")
    print("User data stored in: /users/students/profiles/username/data/")
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)
