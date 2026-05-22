// set-admin.js
// Correlo UNA vez: node set-admin.js
// Seteá TU_EMAIL abajo y listo.

import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ADMIN_EMAIL = 'florio.esteban@gmail.com'; // ← cambiá esto

initializeApp({
  credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  })
});

const db = getFirestore();

async function setAdmin() {
  // Buscar usuario por email
  const snap = await db.collection('users')
    .where('email', '==', ADMIN_EMAIL)
    .limit(1)
    .get();

  if (snap.empty) {
    console.log(`\n  ⚠️  No se encontró el usuario: ${ADMIN_EMAIL}`);
    console.log('  → Primero registrate en la app, después corré este script.\n');
    process.exit(1);
  }

  const doc = snap.docs[0];
  await doc.ref.update({ isAdmin: true });

  console.log(`\n  ✓ Admin seteado correctamente`);
  console.log(`  → uid:   ${doc.id}`);
  console.log(`  → email: ${ADMIN_EMAIL}`);
  console.log(`  → isAdmin: true\n`);
  process.exit(0);
}

setAdmin().catch(err => {
  console.error('\n  ✗ Error:', err.message, '\n');
  process.exit(1);
});
