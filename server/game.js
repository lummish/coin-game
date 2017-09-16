/*
 * Server side game module. Maintains the game state and processes all the messages from clients.
 *
 * Exports:
 *   - addPlayer(name)
 *   - move(direction, name)
 *   - state()
 */
// Set up redis
const redis = require('redis');
const async = require('async');

const client = redis.createClient();
client.on('error', (err) => {
  console.error('Error:', err);
});

const { clamp, randomPoint, permutation, scanValues } = require('./gameutil');

const WIDTH = 64;
const HEIGHT = 64;
const MAX_PLAYER_NAME_LENGTH = 32;
const NUM_COINS = 100;


// A KEY-VALUE "DATABASE" FOR THE GAME STATE.
//
// The game state is maintained in an object. Your homework assignment is to swap this out
// for a Redis database.
//
// In this version, the players never die. For homework, you need to make a player die after
// five minutes of inactivity. You can use the Redis TTL for this.
//
// Here is how the storage is laid out:
//
// player:<name>    string       "<row>,<col>"
// scores           sorted set   playername with score
// coins            hash         { "<row>,<col>": coinvalue }
// usednames        set          all used names, to check quickly if a name has been used
exports.addPlayer = async name => new Promise((resolve, reject) => {
  client.sismember('usednames', name, (err, isMember) => {
    if (err) {
      console.error('Error adding player:', err);
      reject(err);
    }

    if (name.length === 0 || name.length > MAX_PLAYER_NAME_LENGTH ||
      isMember === 1) {
      resolve(false);
    }
    client.sadd('usednames', name); // might be executed before await
    client.setex(`player:${name}`, 300, randomPoint(WIDTH, HEIGHT).toString());
    client.zadd('scores', 0, name); // might be wrong here
    resolve(true);
  });
});

function placeCoins() {
  permutation(WIDTH * HEIGHT).slice(0, NUM_COINS).forEach((position, i) => {
    const coinValue = (i < 50) ? 1 : (i < 75) ? 2 : (i < 95) ? 5 : 10;
    const index = `${Math.floor(position / WIDTH)},${Math.floor(position % WIDTH)}`;
    client.hset('coins', index, coinValue);
  });
}

// Return only the parts of the database relevant to the client. The client only cares about
// the positions of each player, the scores, and the positions (and values) of each coin.
// Note that we return the scores in sorted order, so the client just has to iteratively
// walk through an array of name-score pairs and render them.
exports.state = () => new Promise((resolve, reject) => {
  async.parallel({
    positions: (done) => {
      scanValues('player:*').then(
        ([playerKeys, playerValues]) => {
          const playerPositions = [];
          playerKeys.forEach((playerKey, index) => {
            const playerName = playerKey.substr(7);
            playerPositions.push([playerName, playerValues[index]]);
          });
          done(null, playerPositions);
        },
        (err) => {
          console.error(err);
          done(err);
        },
      );
    },
    scores: (done) => {
      const scoresArray = [];
      client.zrevrange('scores', 0, -1, 'WITHSCORES', (err, playerScores) => {
        if (err) {
          done(err);
        }
        for (let i = 0; i < playerScores.length - 1; i += 2) {
          scoresArray.push([playerScores[i], playerScores[i + 1]]);
        }
        done(null, scoresArray);
      });
    },
    coins: (done) => {
      client.hgetall('coins', (err, coinPositions) => {
        if (err) {
          done(err);
        }
        done(null, coinPositions);
      });
    },
  },
  (err, results) => {
    if (err) {
      console.error(err);
      reject(err);
    }
    resolve(results);
  });
});

/**
 * A function that takes a direction and the player name as input and moves
 * the token that corresponds to that player (if necessary).
 * @param {String} direction : the direction in which the player will move
 * @param {String} name : the name of the player that should be moved
 */
exports.move = (direction, name) => {
  return new Promise((resolve, reject) => {
    const delta = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] }[direction];

    if (delta) {
      const playerKey = `player:${name}`;
      async.autoInject({
        newPosition: (done) => {
          client.get(playerKey, (err, playerPosition) => {
            if (err) {
              done(err);
            }
            const [x, y] = playerPosition.split(',');
            done(null, [
              clamp(+x + delta[0], 0, WIDTH - 1),
              clamp(+y + delta[1], 0, HEIGHT - 1)
            ]);
          });
        },
        value: (newPosition, done) => {
          const [newX, newY] = newPosition;
          client.hget('coins', `${newX},${newY}`, (err, value) => {
            if (err) {
              done(err);
            }
            if (value) {
              client.zincrby('scores', value, name);
              client.hdel('coins', `${newX},${newY}`);
            }
            client.setex(playerKey, 300, `${newX},${newY}`);
            done(null);
          });
        },
      },
      (err) => {
        if (err) {
          console.error(err);
          reject(err);
        }
        client.hgetall('coins', (coinErr, coinList) => {
          if (coinErr) {
            console.error(coinErr);
            reject(coinErr);
          }
          if (coinList.length === 0) {
            placeCoins();
          }
          resolve();
        });
      });
    }
  });
};

placeCoins();
