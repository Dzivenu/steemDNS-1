'use strict';

const wsRPC       = 'wss://node.steem.ws';
const allowedTLD  = ['steem'];
const authority   = { address: '8.8.8.8', port: 53, type: 'udp' };

let dns = require('native-dns');
let server = dns.createServer();

let async     = require('async');
let chalk     = require('chalk');
let {Client}  = require('steem-rpc');

server.on('listening', () => console.log('server listening on', server.address()));
server.on('close', () => console.log('server closed', server.address()));
server.on('error', (err, buff, req, res) => console.error(err.stack));
server.on('socketError', (err, socket) => console.error(err));

server.serve(53);

console.log(chalk.green('Connecting to Steem API server'), wsRPC);
let rpcAPI = Client.get({url: wsRPC}, true);


function proxy(question, response, cb) {
  console.log(chalk.green('Proxied'), chalk.white(question.name));
  var request = dns.Request({
    question: question, // forwarding the question
    server: authority,  // this is the DNS server we are asking
    timeout: 1000
  });

  // when we get answers, append them to the response
  request.on('message', (err, msg) => {
    msg.answer.forEach(a => response.answer.push(a));
  });

  request.on('end', cb);
  request.send();
}

function steemDNS(question, res, cb) {
  console.log(chalk.red('steemDNS'), chalk.white(question.name));
  let domain = question.name.split('.');
  // Get TLD, if it's equal to any allowedTLD do a steem lookup
  let tld = domain[domain.length - 1];
  let username = domain[domain.length - 2];

  rpcAPI.initPromise.then(response => {
    Promise.all([
      rpcAPI.database_api().exec("get_accounts", [[username]])
    ])
    .then(response => {
      let records = [];
      try {
        records = JSON.parse(response[0][0].json_metadata).dns.records;
      } catch(error) { console.log(chalk.red('steemDNS'), chalk.cyan('Not a steem user / no domains added')) }
    
      records.forEach(record => {
        let tempRecord = {};

        if(record[0] == '@' && dns.consts.QTYPE_TO_NAME[question.type] == record[1]) {
          tempRecord.name = question.name;
          tempRecord.ttl = record.ttl || 1800;
          tempRecord.type = record[1];
          tempRecord.address = record[2];

          res.answer.push(dns[tempRecord.type](tempRecord));
        }
      });
    });
  });
}

function handleRequest(request, res) {
  console.log(chalk.cyan.bold('Resolving'), chalk.white(request.question[0].name));
  let queue = [];
  request.question.forEach(question => {
      let domain = question.name.split('.');
      // Get TLD, if it's equal to any allowedTLD do a steem lookup
      let tld = domain[domain.length - 1];

      if (allowedTLD.indexOf(tld) != -1) {
        queue.push(cb => steemDNS(question, res, cb));
      }
      else {
        queue.push(cb => proxy(question, res, cb));
      }
  });

  setTimeout(function() {
    queue = [];
    res.send();
  }, 500);

  async.parallel(queue, function() { res.send(); });
}

server.on('request', handleRequest);