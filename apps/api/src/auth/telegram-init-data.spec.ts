import { InitDataError, signTelegramInitData, verifyTelegramInitData } from './telegram-init-data';

const TOKEN = '123456:TEST-bot-token';
const NOW = 1_700_000_000;
const user = JSON.stringify({ id: 42, first_name: 'Abebe', username: 'abebe' });

describe('verifyTelegramInitData', () => {
  it('accepts correctly signed data and returns the user', () => {
    const initData = signTelegramInitData({ user, auth_date: String(NOW - 10), query_id: 'q1', start_param: 'room_ABC123' }, TOKEN);
    const res = verifyTelegramInitData(initData, TOKEN, 3600, NOW);
    expect(res.user).toMatchObject({ id: 42, first_name: 'Abebe' });
    expect(res.startParam).toBe('room_ABC123');
  });

  it('rejects tampered fields', () => {
    const initData = signTelegramInitData({ user, auth_date: String(NOW) }, TOKEN);
    const tampered = initData.replace('Abebe', 'Mallory');
    expect(() => verifyTelegramInitData(tampered, TOKEN, 3600, NOW)).toThrow(InitDataError);
  });

  it('rejects data signed with another bot token', () => {
    const initData = signTelegramInitData({ user, auth_date: String(NOW) }, 'other:token');
    expect(() => verifyTelegramInitData(initData, TOKEN, 3600, NOW)).toThrow('signature');
  });

  it('rejects expired data', () => {
    const initData = signTelegramInitData({ user, auth_date: String(NOW - 7200) }, TOKEN);
    expect(() => verifyTelegramInitData(initData, TOKEN, 3600, NOW)).toThrow('expired');
  });

  it('rejects missing hash, missing token and malformed users', () => {
    expect(() => verifyTelegramInitData(`user=${encodeURIComponent(user)}&auth_date=${NOW}`, TOKEN, 0, NOW)).toThrow('hash');
    expect(() => verifyTelegramInitData('hash=00', '', 0, NOW)).toThrow('not configured');
    const bad = signTelegramInitData({ user: '{"id":"x"}', auth_date: String(NOW) }, TOKEN);
    expect(() => verifyTelegramInitData(bad, TOKEN, 0, NOW)).toThrow('user');
  });
});
