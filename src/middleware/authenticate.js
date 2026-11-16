const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
    const authorization = req.get('authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Bearer token is required' });
    }

    try {
        const claims = jwt.verify(authorization.slice('Bearer '.length), process.env.JWT_SECRET);
        if (!claims.userId || typeof claims.userId !== 'string') {
            return res.status(403).json({ error: 'INVALID_TOKEN', message: 'Token does not identify a user' });
        }
        req.userId = claims.userId;
        return next();
    } catch (error) {
        return res.status(403).json({ error: 'INVALID_TOKEN', message: 'Bearer token is invalid or expired' });
    }
}

module.exports = authenticate;
