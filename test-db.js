import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL;
console.log('Testing connection to:', url?.replace(/:[^:@]+@/, ':***@'));

const pool = new pg.Pool({ connectionString: url });
pool.connect()
    .then(client => {
        console.log('✅ Connected successfully');
        client.release();
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Connection failed:');
        console.error(err);
        process.exit(1);
    });
