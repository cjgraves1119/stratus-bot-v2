import indexData from './src/index.js';

// Read the test email
import fs from 'fs';
const testEmail = fs.readFileSync('/tmp/test_email.txt', 'utf8');

// Test email detection
const lines = fs.readFileSync('./src/index.js', 'utf8');
const detectEmailContentMatch = lines.match(/function detectEmailContent\(text\) \{[\s\S]*?\n\}/);
if (!detectEmailContentMatch) {
  console.error('Could not extract detectEmailContent function');
  process.exit(1);
}

// Create inline test
eval(detectEmailContentMatch[0]);

console.log('Testing email detection...');
const isEmail = detectEmailContent(testEmail);
console.log(`Email detected: ${isEmail}`);

if (isEmail) {
  console.log('✅ Email detection working!');
} else {
  console.log('❌ Email detection failed');
  process.exit(1);
}
