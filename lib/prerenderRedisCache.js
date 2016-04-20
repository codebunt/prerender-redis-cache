/**
 * Basic Config Variables
 * redis_url (string) - Redis hostname (defaults to localhost)
 * ttl (int) - TTL on keys set in redis (defaults to 1 day)
 */
var redis_url = process.env.REDISTOGO_URL || process.env.REDISCLOUD_URL || process.env.REDISGREEN_URL || process.env.REDIS_URL || "redis://127.0.0.1:6379",
    url = require('url'),
    ttl = process.env.PAGE_TTL || 86400;

// Parse out the connection vars from the env string.
var connection = url.parse(redis_url),
    redis = require('redis'),
    client = redis.createClient(connection.port, connection.hostname),
    redis_online = false,
    last_error = "",
    last_end_message = ""; // Make redis connection

// Select Redis database, parsed from the URL
connection.path = (connection.pathname || '/').slice(1);
connection.database = connection.path.length ? connection.path : '0';
client.select(connection.database);

// Parse out password from the connection string
if (connection.auth) {
    client.auth(connection.auth.split(":")[1]);
}

// Catch all error handler. If redis breaks for any reason it will be reported here.
client.on("error", function (err) {
    if(last_error === err.toString()) { 
      // Swallow the error for now
    } else { 
      last_error = err.toString();
      console.log("Redis Cache Error: " + err);
    }
});
//
client.on("ready", function () {
    redis_online = true;
    console.log("Redis Cache Connected");
});

client.on("end", function (err) {
  if(err) {
    err = err.toString();
    if(last_end_message == err) { 
      // Swallow the error for now
    } else { 
      last_end_message = err;
      redis_online = false;
      console.log("Redis Cache Connection Closed. Will now bypass redis until it's back.");
    }
  }
});

var useragent = require('express-useragent');

module.exports = {
    beforePhantomRequest: function (req, res, next) {
        //
        var source = req.headers['user-agent'];
        console.log(source);
        var ua = useragent.parse(source);
        this.cachekey = (ua.isMobile ? "mobile" : "web") + "-" + req.prerender.url;
        var nocache = req.headers['no-prerender-cache'];
        if (req.method !== 'GET' || redis_online !== true || nocache) {
            return next();
        }
        client.get(this.cachekey, function (err, result) {
            // Page found - return to prerender and 200
            if (!err && result) {
                res.send(200, result);
            } else {
                next();
            }
        });
    },

    afterPhantomRequest: function (req, res, next) {
        if (redis_online !== true) {
            return next();
        }
        // Don't cache anything that didn't result in a 200. This is to stop caching of 3xx/4xx/5xx status codes
        if (req.prerender.statusCode === 200) {
            console.log("Caching.. "+this.cachekey);
            client.set(this.cachekey, req.prerender.documentHTML, function (err, reply) {
                // If library set to cache set an expiry on the key.
                if (!err && reply && ttl && ttl != 0) {
                    client.expire(this.cachekey, ttl, function (err, didSetExpiry) {
                        console.warn(!!didSetExpiry);
                    });
                }
            });
        }
        next();
    }
};

