process.env.JWT_SECRET = 'test-secret';

const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');

jest.mock('../src/models/Message', () => ({
    create: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn()
}));
jest.mock('../src/config/database', () => ({
    getDatabaseStatus: jest.fn()
}));

const Message = require('../src/models/Message');
const { getDatabaseStatus } = require('../src/config/database');
const app = require('../src/app');

const tokenFor = userId => jwt.sign({ userId }, process.env.JWT_SECRET);
const authorization = userId => `Bearer ${tokenFor(userId)}`;

beforeEach(() => {
    jest.clearAllMocks();
    getDatabaseStatus.mockReturnValue('connected');
});

describe('communication API health', () => {
    it('serves liveness without requiring a database connection', async () => {
        const response = await request(app).get('/health/live');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'alive' });
    });

    it('reports degraded readiness when MongoDB is disconnected', async () => {
        getDatabaseStatus.mockReturnValue('disconnected');

        const response = await request(app).get('/health/ready');

        expect(response.status).toBe(503);
        expect(response.body).toEqual({ status: 'degraded', database: 'disconnected' });
    });
});

describe('/api/messages authentication', () => {
    it('requires a bearer token', async () => {
        const response = await request(app).get('/api/messages?withUser=user-2');

        expect(response.status).toBe(401);
    });

    it('rejects invalid JWTs', async () => {
        const response = await request(app)
            .get('/api/messages?withUser=user-2')
            .set('Authorization', 'Bearer invalid');

        expect(response.status).toBe(403);
    });
});

describe('POST /api/messages', () => {
    it('stores the sender from the JWT rather than trusting request data', async () => {
        const createdAt = new Date('2026-11-15T12:00:00.000Z');
        Message.create.mockImplementation(async message => ({
            ...message,
            _id: new mongoose.Types.ObjectId('69187f000000000000000001'),
            createdAt,
            readAt: null
        }));

        const response = await request(app)
            .post('/api/messages')
            .set('Authorization', authorization('patient-1'))
            .send({
                senderId: 'patient-2',
                toUserId: 'doctor-1',
                content: '  Necesito ayuda  '
            });

        expect(response.status).toBe(201);
        expect(Message.create).toHaveBeenCalledWith({
            senderId: 'patient-1',
            recipientId: 'doctor-1',
            content: 'Necesito ayuda'
        });
        expect(response.body.message).toMatchObject({
            id: '69187f000000000000000001',
            senderId: 'patient-1',
            recipientId: 'doctor-1',
            content: 'Necesito ayuda',
            readAt: null
        });
    });

    it.each([
        [{ toUserId: 'doctor-1', content: '   ' }, 'required'],
        [{ toUserId: 'patient-1', content: 'Hola' }, 'yourself'],
        [{ toUserId: 'doctor-1', content: 'x'.repeat(2001) }, '2000']
    ])('rejects invalid message payloads', async (body, expectedMessage) => {
        const response = await request(app)
            .post('/api/messages')
            .set('Authorization', authorization('patient-1'))
            .send(body);

        expect(response.status).toBe(400);
        expect(response.body.message).toContain(expectedMessage);
        expect(Message.create).not.toHaveBeenCalled();
    });
});

describe('GET /api/messages', () => {
    it('requires a distinct conversation participant', async () => {
        const missing = await request(app)
            .get('/api/messages')
            .set('Authorization', authorization('patient-1'));
        const self = await request(app)
            .get('/api/messages?withUser=patient-1')
            .set('Authorization', authorization('patient-1'));

        expect(missing.status).toBe(400);
        expect(self.status).toBe(400);
        expect(Message.find).not.toHaveBeenCalled();
    });

    it('returns only messages in the authenticated user conversation in chronological order', async () => {
        const older = {
            _id: new mongoose.Types.ObjectId('69187f000000000000000001'),
            senderId: 'patient-1',
            recipientId: 'doctor-1',
            content: 'Hola',
            createdAt: new Date('2026-11-15T12:00:00.000Z'),
            readAt: null
        };
        const newer = {
            _id: new mongoose.Types.ObjectId('69187f000000000000000002'),
            senderId: 'doctor-1',
            recipientId: 'patient-1',
            content: 'Buen día',
            createdAt: new Date('2026-11-15T12:01:00.000Z'),
            readAt: null
        };
        Message.find.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([newer, older])
        });

        const response = await request(app)
            .get('/api/messages?withUser=doctor-1&limit=2')
            .set('Authorization', authorization('patient-1'));

        expect(response.status).toBe(200);
        expect(Message.find).toHaveBeenCalledWith({
            $or: [
                { senderId: 'patient-1', recipientId: 'doctor-1' },
                { senderId: 'doctor-1', recipientId: 'patient-1' }
            ]
        });
        expect(response.body.messages.map(message => message.content)).toEqual(['Hola', 'Buen día']);
        expect(JSON.parse(Buffer.from(response.body.nextBefore, 'base64url').toString('utf8')))
            .toEqual({
                createdAt: older.createdAt.toISOString(),
                id: older._id.toString()
            });
    });

    it('rejects invalid limits and cursors', async () => {
        const invalidLimit = await request(app)
            .get('/api/messages?withUser=doctor-1&limit=101')
            .set('Authorization', authorization('patient-1'));
        const invalidCursor = await request(app)
            .get('/api/messages?withUser=doctor-1&before=not-a-cursor')
            .set('Authorization', authorization('patient-1'));

        expect(invalidLimit.status).toBe(400);
        expect(invalidCursor.status).toBe(400);
        expect(Message.find).not.toHaveBeenCalled();
    });

    it('uses the opaque timestamp and message id cursor to avoid skipping tied messages', async () => {
        const cursorId = '69187f000000000000000001';
        const cursor = Buffer.from(JSON.stringify({
            createdAt: '2026-11-15T12:00:00.000Z',
            id: cursorId
        })).toString('base64url');
        Message.find.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([])
        });

        const response = await request(app)
            .get(`/api/messages?withUser=doctor-1&before=${cursor}`)
            .set('Authorization', authorization('patient-1'));

        expect(response.status).toBe(200);
        expect(Message.find).toHaveBeenCalledWith({
            $or: [
                { senderId: 'patient-1', recipientId: 'doctor-1' },
                { senderId: 'doctor-1', recipientId: 'patient-1' }
            ],
            $and: [{
                $or: [
                    { createdAt: { $lt: new Date('2026-11-15T12:00:00.000Z') } },
                    {
                        createdAt: new Date('2026-11-15T12:00:00.000Z'),
                        _id: { $lt: cursorId }
                    }
                ]
            }]
        });
    });
});

describe('PATCH /api/messages/:id/read', () => {
    it('marks a message read only for its recipient', async () => {
        const messageId = '69187f000000000000000001';
        const message = {
            _id: new mongoose.Types.ObjectId(messageId),
            senderId: 'doctor-1',
            recipientId: 'patient-1',
            content: 'Respuesta',
            createdAt: new Date('2026-11-15T12:00:00.000Z'),
            readAt: new Date('2026-11-15T12:01:00.000Z')
        };
        Message.findOneAndUpdate.mockReturnValue({
            lean: jest.fn().mockResolvedValue(message)
        });

        const response = await request(app)
            .patch(`/api/messages/${messageId}/read`)
            .set('Authorization', authorization('patient-1'));

        expect(response.status).toBe(200);
        expect(Message.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: messageId, recipientId: 'patient-1' },
            { $set: { readAt: expect.any(Date) } },
            { new: true, runValidators: true }
        );
        expect(response.body.message.readAt).toBe(message.readAt.toISOString());
    });

    it('does not disclose messages belonging to another recipient', async () => {
        Message.findOneAndUpdate.mockReturnValue({
            lean: jest.fn().mockResolvedValue(null)
        });

        const response = await request(app)
            .patch('/api/messages/69187f000000000000000001/read')
            .set('Authorization', authorization('patient-2'));

        expect(response.status).toBe(404);
    });
});
