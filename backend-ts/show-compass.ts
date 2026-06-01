import 'dotenv/config';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';

async function showDatabases() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const admin = client.db('admin');

  console.log('=== DATABASES ===');
  const databases = await admin.admin().listDatabases();
  databases.databases.forEach(db => {
    console.log(`📁 ${db.name}`);
  });

  console.log('\n=== ITRS DATABASE DETAILS ===');
  const itrsDb = client.db('itrs');
  
  console.log('Collections in itrs:');
  const collections = await itrsDb.listCollections().toArray();
  collections.forEach(col => {
    console.log(`  📄 ${col.name}`);
  });

  console.log('\n=== USERS COLLECTION ===');
  const usersCollection = itrsDb.collection('users');
  const userCount = await usersCollection.countDocuments();
  console.log(`Total users: ${userCount}`);
  
  const users = await usersCollection.find({}).toArray();
  users.forEach((user, index) => {
    console.log(`\n${index + 1}. Username: ${user.username}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   First Name: ${user.first_name}`);
    console.log(`   ID: ${user._id}`);
  });

  console.log('\n=== REQUESTS COLLECTION ===');
  const requestsCollection = itrsDb.collection('requests');
  const requestCount = await requestsCollection.countDocuments();
  console.log(`Total requests: ${requestCount}`);
  
  if (requestCount > 0) {
    const requests = await requestsCollection.find({}).limit(5).toArray();
    requests.forEach((req, index) => {
      console.log(`\n${index + 1}. Request Code: ${req.request_code}`);
      console.log(`   Status: ${req.status}`);
      console.log(`   Office: ${req.office}`);
    });
  }

  await client.close();
}

showDatabases().catch(console.error);
