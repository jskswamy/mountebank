'use strict';

var http = require('http'),
    https = require('https'),
    url = require('url'),
    Q = require('q'),
    AbstractProxy = require('../abstractProxy'),
    combinators = require('../../util/combinators'),
    querystring = require('querystring'),
    helpers = require('../../util/helpers');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function create (logger) {

    function toUrl (path, query) {
        var tail = querystring.stringify(query);
        if (tail === '') {
            return path;
        }
        return path + '?' + tail;
    }

    function hostnameFor (protocol, host, port) {
        var result = host;
        if ((protocol === 'http:' && port !== 80) || (protocol === 'https:' && port !== 443)) {
            result += ':' + port;
        }
        return result;
    }

    function getProxyRequest (baseUrl, originalRequest) {
        var parts = url.parse(baseUrl),
            protocol = parts.protocol === 'https:' ? https : http,
            defaultPort = parts.protocol === 'https:' ? 443 : 80,
            options = {
                method: originalRequest.method,
                hostname: parts.hostname,
                port: parts.port || defaultPort,
                auth: parts.auth,
                path: toUrl(originalRequest.path, originalRequest.query),
                headers: helpers.clone(originalRequest.headers)
            };
        options.headers.connection = 'close';
        options.headers.host = hostnameFor(parts.protocol, parts.hostname, options.port);

        var proxiedRequest = protocol.request(options);
        if (originalRequest.body) {
            proxiedRequest.write(originalRequest.body);
        }
        return proxiedRequest;
    }

    function isBinaryResponse (headers) {
        var contentEncoding = headers['content-encoding'] || '',
            contentType = headers['content-type'] || '';

        if (contentEncoding.indexOf('gzip') >= 0) {
            return true;
        }

        if (contentType === 'application/octet-stream') {
            return true;
        }

        return ['audio', 'image', 'video'].some(function (typeName) {
            return contentType.indexOf(typeName) === 0;
        });
    }

    function proxy (proxiedRequest) {
        var deferred = Q.defer();

        proxiedRequest.end();

        proxiedRequest.once('response', function (response) {
            var packets = [];

            response.on('data', function (chunk) {
                packets.push(chunk);
            });

            response.on('end', function () {
                var body = Buffer.concat(packets),
                    mode = isBinaryResponse(response.headers) ? 'binary' : 'text',
                    encoding = mode === 'binary' ? 'base64' : 'utf8',
                    stubResponse = {
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: body.toString(encoding),
                        _mode: mode
                    };
                deferred.resolve(stubResponse);
            });
        });

        return deferred.promise;
    }

    return AbstractProxy.create({
        logger: logger,
        formatRequest: combinators.identity,
        formatResponse: combinators.identity,
        formatDestination: combinators.identity,
        getProxyRequest: getProxyRequest,
        proxy: proxy
    });
}

module.exports = {
    create: create
};
