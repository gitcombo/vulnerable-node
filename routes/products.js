import express from 'express';
import check_logged from './login_check.js';
import url from 'url';
import db_products from '../model/products.js';
import { validateProductId, validateSearchQuery, validatePurchase } from '../src/interface/http/validators/productValidators.js';

const router = express.Router();

// Apply auth middleware to all product routes
router.use(check_logged);

/* GET home page. */
router.get('/', function(req, res, next) {
    db_products.list()
        .then(function (data) {
            res.render('products', { products: data });
        })
        .catch(function (err) {
            console.error('[PRODUCTS] Error listing products:', err.message);
            res.render('products', { products: [] });
        });
});

router.get('/products/purchased', function(req, res, next) {
    db_products.getPurchased(req.session.user_name)
        .then(function (data) {
            res.render('bought_products', { products: data });
        })
        .catch(function (err) {
            console.error('[PRODUCTS] Error getting purchases:', err.message);
            res.render('bought_products', { products: [] });
        });
});

router.get('/products/detail', validateProductId, function(req, res, next) {
    const url_params = url.parse(req.url, true).query;
    const product_id = url_params.id;

    db_products.getProduct(product_id)
        .then(function (data) {
            if (!data) {
                return res.status(404).render('error', { message: 'Product not found', error: {} });
            }
            res.render('product_detail', { product: data });
        })
        .catch(function (err) {
            console.error('[PRODUCTS] Error getting product detail:', err.message);
            res.render('products', { products: [] });
        });
});

router.get('/products/search', validateSearchQuery, function(req, res, next) {
    const url_params = url.parse(req.url, true).query;
    const query = url_params.q;

    if (query === undefined || query === '') {
        res.render('search', { in_query: "", products: [] });
        return;
    }

    db_products.search(query)
        .then(function (data) {
            res.render('search', { in_query: query, products: data || [] });
        })
        .catch(function (err) {
            console.error('[PRODUCTS] Error searching products:', err.message);
            res.render('search', { in_query: query, products: [] });
        });
});

router.all('/products/buy', validatePurchase, function(req, res, next) {
    // req.validatedBody is set by validatePurchase middleware (Zod PurchaseSchema).
    // All fields are already validated and present — no redundant checks needed.
    const params = req.validatedBody;

    const cart = {
        mail: params.mail,
        address: params.address,
        ship_date: params.ship_date,
        phone: params.phone,
        product_id: params.product_id,
        product_name: params.product_name,
        username: req.session.user_name,
        price: params.price.slice(0, -1)
    };

    db_products.purchase(cart)
        .then(function () {
            return res.json({ message: "Product purchased correctly" });
        })
        .catch(function (err) {
            console.error('[PRODUCTS] Error purchasing product:', err.message);
            return res.status(500).json({ message: "Error processing purchase" });
        });
});

export default router;
