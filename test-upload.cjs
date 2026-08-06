const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

async function testUpload() {
  const form = new FormData();
  fs.writeFileSync('dummy.pdf', 'dummy content');
  form.append('file', fs.createReadStream('dummy.pdf'));
  form.append('title', 'Test PDF');
  form.append('type', 'PDF');
  form.append('lectureId', 'mock-id-123'); // Just some id

  // We need an admin token. We can generate one since we have JWT_SECRET.
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ userId: 'admin', email: 'admin@med99.local' }, process.env.JWT_SECRET || 'dev-secret-key');

  try {
    const res = await axios.post('http://127.0.0.1:3000/api/materials/upload', form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${token}`
      }
    });
    console.log(res.data);
  } catch (e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
testUpload();
