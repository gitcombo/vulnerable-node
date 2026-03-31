import { performance } from 'node:perf_hooks';
import { LoginSchema } from '../../src/interface/http/validators/authValidators.js';
import { ProductIdSchema, SearchQuerySchema, PurchaseSchema } from '../../src/interface/http/validators/productValidators.js';

describe('LoginSchema', () => {
    it('should accept valid login data', () => {
        const result = LoginSchema.safeParse({ username: 'admin', password: 'admin123' });
        expect(result.success).toBe(true);
    });

    it('should reject username shorter than 3 chars', () => {
        const result = LoginSchema.safeParse({ username: 'ab', password: 'password123' });
        expect(result.success).toBe(false);
    });

    it('should reject username with special characters', () => {
        const result = LoginSchema.safeParse({ username: "admin' OR '1'='1", password: 'password' });
        expect(result.success).toBe(false);
    });

    it('should reject empty password', () => {
        const result = LoginSchema.safeParse({ username: 'admin', password: '' });
        expect(result.success).toBe(false);
    });

    it('should reject password longer than 128 chars', () => {
        const result = LoginSchema.safeParse({ username: 'admin', password: 'a'.repeat(129) });
        expect(result.success).toBe(false);
    });
});

describe('ProductIdSchema', () => {
    it('should accept numeric string ID', () => {
        const result = ProductIdSchema.safeParse({ id: '123' });
        expect(result.success).toBe(true);
    });

    it('should reject non-numeric ID', () => {
        const result = ProductIdSchema.safeParse({ id: "1' OR '1'='1" });
        expect(result.success).toBe(false);
    });
});

describe('SearchQuerySchema', () => {
    it('should accept valid search query', () => {
        const result = SearchQuerySchema.safeParse({ q: 'phone' });
        expect(result.success).toBe(true);
    });

    it('should reject query longer than 200 chars', () => {
        const result = SearchQuerySchema.safeParse({ q: 'a'.repeat(201) });
        expect(result.success).toBe(false);
    });
});

describe('PurchaseSchema', () => {
    it('should accept valid purchase data', () => {
        const result = PurchaseSchema.safeParse({
            mail: 'test@example.com',
            address: '123 Main St',
            ship_date: '2025-01-01',
            phone: '555-1234',
            price: '99€',
            product_id: '1',
            product_name: 'Test Product'
        });
        expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
        const result = PurchaseSchema.safeParse({
            mail: 'not-an-email',
            address: '123 Main St',
            ship_date: '2025-01-01',
            phone: '555-1234',
            price: '99€',
            product_id: '1',
            product_name: 'Test Product'
        });
        expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
        const result = PurchaseSchema.safeParse({
            mail: 'test@example.com'
        });
        expect(result.success).toBe(false);
    });

    it('should handle ReDoS attack payload without hanging', () => {
        // Input que congela el regex vulnerable en ~2.7 segundos.
        // Zod debe rechazarlo en < 50ms.
        const start = performance.now();
        const result = PurchaseSchema.safeParse({
            mail: 'a'.repeat(33) + '!',
            address: '123 Main St',
            ship_date: '2025-01-01',
            phone: '555-1234',
            price: '99€',
            product_id: '1',
            product_name: 'Test Product'
        });
        const elapsed = performance.now() - start;
        expect(result.success).toBe(false);
        expect(elapsed).toBeLessThan(50);
    });
});
