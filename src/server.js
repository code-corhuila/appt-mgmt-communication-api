require('dotenv').config();
const app = require('./app');
const { connectDatabase, closeDatabase } = require('./config/database');

const port = Number(process.env.PORT || 3004);

async function start() {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is required and must match the authentication service');
    }

    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`Communication API listening on ${port}`);
    });
    connectDatabase().catch(error => {
        console.error('Communication MongoDB unavailable; API remains live but not ready:', error.message);
    });

    const shutdown = signal => {
        console.log(`Communication API received ${signal}`);
        server.close(error => {
            if (error) {
                console.error('HTTP server shutdown failed:', error.message);
                process.exitCode = 1;
            }
            closeDatabase().catch(closeError => {
                console.error('MongoDB shutdown failed:', closeError.message);
                process.exitCode = 1;
            });
        });
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
    start().catch(error => {
        console.error('Communication API startup failed:', error.message);
        process.exitCode = 1;
    });
}
