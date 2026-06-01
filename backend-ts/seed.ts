import 'dotenv/config';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcrypt';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const MONGO_DB = process.env.MONGO_DB || 'itrs';

async function seed() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(MONGO_DB);
  const users = db.collection('users');

  const testUsers = [
    {
      username: 'admin',
      password: await bcrypt.hash('admin123', 10),
      first_name: 'Admin',
      middle_name: '',
      last_name: 'User',
      role: 'ADMIN',
      office: 'IT Department',
      created_at: new Date()
    },
    {
      username: 'tech1',
      password: await bcrypt.hash('tech123', 10),
      first_name: 'John',
      middle_name: 'D',
      last_name: 'Smith',
      role: 'TECHNICIAN',
      office: 'IT Department',
      created_at: new Date()
    },
    {
      username: 'client1',
      password: await bcrypt.hash('client123', 10),
      first_name: 'Jane',
      middle_name: 'M',
      last_name: 'Doe',
      role: 'CLIENT',
      office: 'Office of the Mayor',
      created_at: new Date()
    }
  ];

  for (const user of testUsers) {
    const existing = await users.findOne({ username: user.username });
    if (!existing) {
      await users.insertOne(user);
      console.log(`Created user: ${user.username}`);
    } else {
      console.log(`User already exists: ${user.username}`);
    }
  }

  await client.close();
  console.log('Seeding complete!');
}

seed().catch(console.error);
