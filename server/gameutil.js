const redis = require('redis');

const client = redis.createClient();

exports.clamp = (value, low, high) => Math.max(low, Math.min(high, value));

exports.randomPoint = (maxX, maxY) => [
  Math.floor(Math.random() * maxX),
  Math.floor(Math.random() * maxY),
];

// Returns an array of size n with the values 0..n-1 in random positions.
exports.permutation = (n) => {
  const array = Array(n).fill(0).map((_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

/**
 * Scans through the redis database to find the key,value pairs that match
 * the given match expression.
 * @param {String} matchExpression : the string expression for which all returned
 *   keys are desired to match.
 */
exports.scanValues = pattern => new Promise((resolve, reject) => {
  let keys = [];
  let values = [];

  const scanHelper = () => client.scan('0', 'MATCH', pattern, (err, res) => {
    if (err) {
      reject(err);
    }
    const [cursor, matches] = res;
    keys = keys.concat(matches);

    // If no matches, end
    if (matches.length === 0) {
      resolve([keys, values]);
    }
    // Otherwise get values for matches
    client.mget(matches, (valuesErr, newValues) => {
      if (valuesErr) {
        reject(valuesErr);
      }
      values = values.concat(newValues);
      if (cursor === '0') {
        console.log('Scan Complete');
        resolve([keys, values]);
      } else {
        return scanHelper();
      }
    });
  });

  scanHelper();
});

