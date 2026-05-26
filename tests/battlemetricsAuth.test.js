const assert = require('assert');

const {
    buildBattlemetricsRequestConfig,
    getBattlemetricsRequestFailureDetails
} = require('../src/util/battlemetricsAuth.js');

assert.deepStrictEqual(buildBattlemetricsRequestConfig(''), undefined);
assert.deepStrictEqual(buildBattlemetricsRequestConfig(null), undefined);
assert.deepStrictEqual(buildBattlemetricsRequestConfig(' bm_token '), {
    headers: {
        Authorization: 'Bearer bm_token'
    }
});

assert.strictEqual(getBattlemetricsRequestFailureDetails({ response: { status: 429 } }), ' status=429');
assert.strictEqual(getBattlemetricsRequestFailureDetails({ code: 'ECONNABORTED' }), ' code=ECONNABORTED');
assert.strictEqual(getBattlemetricsRequestFailureDetails(null), '');

console.log('battlemetrics auth tests passed');
