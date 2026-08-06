import fs from 'fs';
import jwt from 'jsonwebtoken';

async function testUpload() {
  const form = new FormData();
  fs.writeFileSync('dummy.pdf', 'dummy content');
  
  const blob = new Blob([fs.readFileSync('dummy.pdf')], { type: 'application/pdf' });
  form.append('file', blob, 'dummy.pdf');
  form.append('title', 'Test PDF');
  form.append('type', 'PDF');
  form.append('lectureId', '33106d10-2187-4b6e-89a9-0aa7c8bdd701');

  const token = jwt.sign({ userId: 'usr_b30096c1-573a-4a49-b43a-cc194e57ce81', email: 'mostafa.samad24001@comed.uobaghdad.edu.iq' }, process.env.JWT_SECRET || 'dev-secret-key');

  try {
    const res = await fetch('http://127.0.0.1:3000/api/materials/upload', {
      method: 'POST',
      body: form,
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) {
      console.error(res.status, await res.text());
    } else {
      console.log(res.status, await res.json());
    }
  } catch (e) {
    console.error(e.message);
  }
}
testUpload();
