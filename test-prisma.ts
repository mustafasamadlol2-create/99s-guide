import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function run() {
  try {
    const lectureId = (await prisma.lecture.findFirst())?.id;
    if (!lectureId) { console.log("No lecture"); return; }
    
    await prisma.material.create({
      data: {
        title: 'Test',
        type: 'PDF',
        fileUrlOrLink: '/api/materials/pdf/test',
        lectureId: lectureId,
        fileData: Buffer.from('test')
      }
    });
    console.log("Success");
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
run();
