import db from './db.js';
import dummy from '../dummy.js';
import { PasswordHasher } from '../src/infrastructure/security/PasswordHasher.js';
import { performance } from 'node:perf_hooks';

async function init_db() {
    try {
        // Create tables
        await db.none('CREATE TABLE IF NOT EXISTS users(name VARCHAR(100) PRIMARY KEY, password VARCHAR(255))');
        await db.none('CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, description TEXT NOT NULL, price INTEGER, image VARCHAR(500))');
        await db.none('CREATE TABLE IF NOT EXISTS purchases(id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, product_name VARCHAR(100) NOT NULL, user_name VARCHAR(100), mail VARCHAR(100) NOT NULL, address VARCHAR(100) NOT NULL, phone VARCHAR(40) NOT NULL, ship_date VARCHAR(100) NOT NULL, price INTEGER NOT NULL)');

        // Insert dummy users with hashed passwords — Promise.all (parallel)
        const users = dummy.users;
        const t0 = performance.now();

        const hashedUsers = await Promise.all(
            users.map(u =>
                PasswordHasher.hash(u.password)
                    .then(hash => ({ username: u.username, hash }))
            )
        );

        const hashingMs = (performance.now() - t0).toFixed(0);
        console.log(`[INIT_DB] Hashing completado en ${hashingMs}ms (${users.length} usuarios en paralelo)`);

        for (const { username, hash } of hashedUsers) {
            await db.none(
                'INSERT INTO users(name, password) VALUES($1, $2) ON CONFLICT (name) DO UPDATE SET password = $2',
                [username, hash]
            ).catch(() => {});
        }
        console.log('[INIT_DB] Users initialized with hashed passwords');

        // Insert dummy products
        const products = dummy.products;
        for (let i = 0; i < products.length; i++) {
            const p = products[i];
            await db.none(
                'INSERT INTO products(id, name, description, price, image) VALUES($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
                [i, p.name, p.description, p.price, p.image]
            ).catch(() => {});
        }
        console.log('[INIT_DB] Products initialized');

    } catch (err) {
        console.error('[INIT_DB] Error initializing database:', err.message);
    }
}

export default init_db;
