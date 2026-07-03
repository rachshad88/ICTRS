import 'dotenv/config';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const MONGO_DB = process.env.MONGO_DB || 'itrs';

async function checkUsers() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(MONGO_DB);
  const users = db.collection('users');

  console.log('All users in database:');
  const allUsers = await users.find({}).toArray();
  allUsers.forEach(user => {
    console.log(`\nUsername: ${user.username}`);
    console.log(`Role: ${user.role}`);
    console.log(`First name: ${user.first_name}`);
    console.log(`Office: ${user.office}`);
  });

  await client.close();
}

checkUsers().catch(console.error);
