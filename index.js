const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const cheerio = require('cheerio');

const app = express();

// ==================== MIDDLEWARE ====================
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 120 * 1000, // 2 minutes
  max: 2, // Only 2 accounts per 2 minutes
  message: { success: false, message: 'Please wait before creating more accounts' }
});
app.use('/api/', limiter);

// ==================== DATABASES ====================
const filipinoFirstNames = {
  male: ["Jake", "John", "Mark", "Michael", "Ryan", "Arvin", "Kevin", "Ian", "Carlo", "Jeffrey",
         "Joshua", "Bryan", "Jericho", "Christian", "Vincent", "Angelo", "Francis", "Patrick"],
  female: ["Maria", "Ana", "Lisa", "Jennifer", "Christine", "Catherine", "Jocelyn", "Marilyn",
           "Angel", "Princess", "Mary Joy", "Rose Ann", "Liezl", "Aileen", "Darlene", "Shiela"]
};

const filipinoSurnames = ["Dela Cruz", "Santos", "Reyes", "Garcia", "Mendoza", "Flores", "Gonzales", 
                          "Lopez", "Cruz", "Perez", "Fernandez", "Villanueva", "Ramos", "Aquino"];

// ==================== HELPER FUNCTIONS ====================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const generateRandomString = (length) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

const generateStrongPassword = (length = 14) => {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const symbols = "!@#$%^&*";
  
  let password = "";
  password += upper[Math.floor(Math.random() * upper.length)];
  password += lower[Math.floor(Math.random() * lower.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];
  
  const all = upper + lower + numbers + symbols;
  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }
  
  return password.split('').sort(() => Math.random() - 0.5).join('');
};

// Generate Yopmail email
const generateYopmailEmail = (firstName, lastName) => {
  const cleanFirstName = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const cleanLastName = lastName.toLowerCase().replace(/[^a-z]/g, '');
  const randomNum = Math.floor(Math.random() * 9999);
  
  const formats = [
    `${cleanFirstName}.${cleanLastName}`,
    `${cleanFirstName}${cleanLastName}`,
    `${cleanFirstName}${randomNum}`,
    `${cleanFirstName}_${cleanLastName}`,
    `${cleanFirstName.charAt(0)}${cleanLastName}${randomNum}`
  ];
  
  const username = formats[Math.floor(Math.random() * formats.length)];
  return `${username}@yopmail.com`;
};

const getRandomDate = (startYear = 1976, endYear = 2004) => {
  const year = startYear + Math.floor(Math.random() * (endYear - startYear + 1));
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRandomName = () => {
  const gender = Math.random() < 0.5 ? 'male' : 'female';
  const names = gender === 'male' ? filipinoFirstNames.male : filipinoFirstNames.female;
  return {
    firstName: names[Math.floor(Math.random() * names.length)],
    lastName: filipinoSurnames[Math.floor(Math.random() * filipinoSurnames.length)],
    gender: gender === 'male' ? 'M' : 'F'
  };
};

const USER_AGENTS = [
  "[FBAN/FB4A;FBAV/35.0.0.48.273;FBDM/{density=1.33125,width=800,height=1205};FBLC/en_US;FBCR/;FBPN/com.facebook.katana;FBDV/Nexus 7;FBSV/4.1.1;FBBK/0;]",
  "[FBAN/FB4A;FBAV/39.0.0.28.141;FBDM/{density=2.0,width=1080,height=1920};FBLC/en_US;FBCR/;FBPN/com.facebook.katana;FBDV/SM-G950F;FBSV/7.0;FBBK/0;]",
  "[FBAN/FB4A;FBAV/42.0.0.18.149;FBDM/{density=2.0,width=1080,height=1776};FBLC/en_US;FBCR/;FBPN/com.facebook.katana;FBDV/iPhone8,1;FBSV/10.0;FBBK/0;]"
];

// ==================== YOPMAIL CONFIRMATION CODE EXTRACTOR ====================
async function getYopmailConfirmationCode(email) {
  try {
    const username = email.split('@')[0];
    console.log(`[+] Checking Yopmail inbox: ${username}`);
    
    // Yopmail webmail URL
    const inboxUrl = `https://webmail.yopmail.com/?r=${username}&p=1&d=&ctrl=v&spam=true`;
    
    const response = await axios.get(inboxUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    let confirmationCode = null;
    let emailContent = '';
    
    // Look for Facebook confirmation email
    $('div.mail, div.msg, div.mail-content, div.message').each((i, elem) => {
      const text = $(elem).text();
      if (text.includes('Facebook') || text.includes('confirmation') || text.includes('code')) {
        emailContent = text;
        
        // Extract confirmation code (6 digits)
        const codeMatch = text.match(/\b(\d{6})\b/);
        if (codeMatch) {
          confirmationCode = codeMatch[1];
        }
        
        // Also look for codes like: XYZ123
        const codeMatch2 = text.match(/\b([A-Z0-9]{6,8})\b/);
        if (codeMatch2 && !confirmationCode) {
          confirmationCode = codeMatch2[1];
        }
      }
    });
    
    return {
      success: !!confirmationCode,
      code: confirmationCode,
      emailUsername: username,
      yopmailLink: `https://yopmail.com/en/?login=${username}`,
      emailPreview: emailContent.substring(0, 500)
    };
    
  } catch (error) {
    console.error('[-] Yopmail fetch error:', error.message);
    return {
      success: false,
      code: null,
      error: error.message
    };
  }
}

// Poll Yopmail for confirmation code (max 10 attempts)
async function pollForConfirmationCode(email, maxAttempts = 10, interval = 5000) {
  console.log(`[+] Polling Yopmail for confirmation code (${maxAttempts} attempts, ${interval/1000}s interval)`);
  
  for (let i = 1; i <= maxAttempts; i++) {
    console.log(`[+] Attempt ${i}/${maxAttempts}...`);
    
    const result = await getYopmailConfirmationCode(email);
    
    if (result.success && result.code) {
      console.log(`[+] Confirmation code found: ${result.code}`);
      return result;
    }
    
    if (i < maxAttempts) {
      await sleep(interval);
    }
  }
  
  console.log(`[-] No confirmation code found after ${maxAttempts} attempts`);
  return { success: false, code: null };
}

// ==================== FACEBOOK ACCOUNT CREATION ====================
async function createFacebookAccount(email, password, firstName, lastName, gender, birthday) {
  const api_key = "882a8490361da98702bf97a021ddc14d";
  const secret = "62f8ce9f74b12f84c123cc23437a4a32";
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const deviceId = generateRandomString(16).toUpperCase();
  
  const requestData = {
    api_key: api_key,
    attempt_login: true,
    birthday: birthday,
    client_country_code: "PH",
    client_locale: "en_US",
    email: email,
    fb_api_caller_class: "com.facebook.registration.protocol.RegisterAccountMethod",
    fb_api_req_friendly_name: "registerAccount",
    firstname: firstName,
    format: "json",
    gender: gender,
    lastname: lastName,
    locale: "en_US",
    method: "user.register",
    password: password,
    reg_instance: generateRandomString(32),
    return_multiple_errors: true,
    device_id: deviceId,
    currently_logged_in_userid: "0",
    family_name: lastName,
    give_name: firstName,
    screen_width: 1080,
    screen_height: 1920,
    screen_density: 2.0,
    timezone: "Asia/Manila"
  };
  
  // Generate signature
  const sigString = Object.keys(requestData)
    .sort()
    .map(key => `${key}=${requestData[key]}`)
    .join('') + secret;
  requestData.sig = crypto.createHash('md5').update(sigString).digest('hex');
  
  const response = await axios.post("https://b-api.facebook.com/method/user.register", 
    new URLSearchParams(requestData), {
    headers: {
      "User-Agent": userAgent,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "X-FB-Connection-Type": "WIFI",
      "X-FB-Device-ID": deviceId
    },
    timeout: 45000
  });
  
  if (response.data && !response.data.error) {
    const userId = response.data.new_user_id || response.data.uid || response.data.id;
    return {
      success: true,
      userId: userId,
      profileLink: `https://facebook.com/profile.php?id=${userId}`,
      raw: response.data
    };
  } else {
    return {
      success: false,
      error: response.data.error_msg || response.data.error || 'Registration failed',
      errorCode: response.data.error_code
    };
  }
}

// ==================== API ROUTES ====================
// Serve API documentation
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// MAIN GET ENDPOINT - Auto create account with confirmation code
app.get('/create', async (req, res) => {
  const startTime = Date.now();
  const requestId = generateRandomString(6).toUpperCase();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${requestId}] GET /create - New request`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    // Optional parameters from query string
    let { firstName, lastName, email, password, gender, birthday } = req.query;
    
    // Generate random profile if not provided
    const name = firstName && lastName ? { firstName, lastName, gender: gender || 'M' } : getRandomName();
    const finalFirstName = firstName || name.firstName;
    const finalLastName = lastName || name.lastName;
    const finalGender = gender || name.gender;
    const finalBirthday = birthday || getRandomDate();
    const finalEmail = email || generateYopmailEmail(finalFirstName, finalLastName);
    const finalPassword = password || generateStrongPassword();
    
    console.log(`[${requestId}] Account details:`);
    console.log(`   Name: ${finalFirstName} ${finalLastName}`);
    console.log(`   Email: ${finalEmail}`);
    console.log(`   Password: ${finalPassword}`);
    console.log(`   Birthday: ${finalBirthday}`);
    
    // Step 1: Create Facebook Account
    console.log(`\n[${requestId}] Step 1: Creating Facebook account...`);
    const creation = await createFacebookAccount(
      finalEmail, finalPassword, finalFirstName, finalLastName, 
      finalGender, finalBirthday
    );
    
    if (!creation.success) {
      console.log(`[${requestId}] ❌ Account creation failed: ${creation.error}`);
      return res.status(400).json({
        success: false,
        message: 'Failed to create Facebook account',
        error: creation.error,
        errorCode: creation.errorCode,
        request_id: requestId,
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`[${requestId}] ✅ Account created! User ID: ${creation.userId}`);
    
    // Step 2: Wait for email to arrive
    console.log(`\n[${requestId}] Step 2: Waiting for confirmation email...`);
    await sleep(8000); // Wait 8 seconds for email to arrive
    
    // Step 3: Poll Yopmail for confirmation code
    console.log(`\n[${requestId}] Step 3: Fetching confirmation code from Yopmail...`);
    const confirmation = await pollForConfirmationCode(finalEmail, 12, 5000);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Step 4: Return complete response
    const response = {
      success: true,
      message: confirmation.code ? 'Account created and confirmation code retrieved' : 'Account created but confirmation code not found yet',
      request_id: requestId,
      duration_seconds: parseFloat(duration),
      account: {
        email: finalEmail,
        password: finalPassword,
        firstName: finalFirstName,
        lastName: finalLastName,
        fullName: `${finalFirstName} ${finalLastName}`,
        birthday: finalBirthday,
        gender: finalGender,
        userId: creation.userId,
        profileLink: creation.profileLink,
        yopmailInbox: `https://yopmail.com/en/?login=${finalEmail.split('@')[0]}`
      },
      confirmation: {
        code: confirmation.code || null,
        found: confirmation.success,
        yopmailLink: confirmation.yopmailLink || null,
        message: confirmation.code ? 'Confirmation code extracted from Yopmail' : 'Check Yopmail inbox manually for confirmation code'
      },
      timestamp: new Date().toISOString()
    };
    
    console.log(`\n[${requestId}] ✅ COMPLETED in ${duration}s`);
    console.log(`   Confirmation code: ${confirmation.code || 'NOT FOUND'}`);
    console.log(`${'='.repeat(60)}\n`);
    
    res.json(response);
    
  } catch (error) {
    console.error(`[${requestId}] ❌ Error:`, error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
      request_id: requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Facebook Account Creator with Yopmail',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Generate email only
app.get('/generate-email', (req, res) => {
  const name = getRandomName();
  const email = generateYopmailEmail(name.firstName, name.lastName);
  res.json({
    success: true,
    email: email,
    yopmailLogin: `https://yopmail.com/en/?login=${email.split('@')[0]}`,
    suggestedName: `${name.firstName} ${name.lastName}`
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    available_endpoints: [
      'GET  /',
      'GET  /create',
      'GET  /health',
      'GET  /generate-email'
    ]
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 FACEBOOK ACCOUNT CREATOR API v3.0');
  console.log('='.repeat(60));
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🔗 Create Account: http://localhost:${PORT}/create`);
  console.log(`📚 API Docs: http://localhost:${PORT}`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
  console.log('\n📧 Email Provider: @yopmail.com');
  console.log('🛡️ Auto confirmation code extraction: ENABLED');
  console.log('⚡ Rate Limit: 2 accounts/2 minutes');
  console.log('='.repeat(60) + '\n');
});