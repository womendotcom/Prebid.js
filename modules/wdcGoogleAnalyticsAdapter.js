/**
 * ga.js - analytics adapter for google analytics
 */

var events = require('src/events');
var utils = require('src/utils');
var CONSTANTS = require('src/constants.json');
var adaptermanager = require('src/adaptermanager');

var BID_REQUESTED = CONSTANTS.EVENTS.BID_REQUESTED;
var BID_TIMEOUT = CONSTANTS.EVENTS.BID_TIMEOUT;
var BID_RESPONSE = CONSTANTS.EVENTS.BID_RESPONSE;
var BID_WON = CONSTANTS.EVENTS.BID_WON;
var AUCTION_INIT = CONSTANTS.EVENTS.AUCTION_INIT;
var AUCTION_END = CONSTANTS.EVENTS.AUCTION_END;

var _disableInteraction = { nonInteraction: true };
var _analyticsQueue = [];
var _gaGlobal = null;
var _enableCheck = true;
var _category = 'Prebid.js Bids';
var _eventCount = 0;
var _enableDistribution = false;
var _trackerSend = null;
var _sampled = true;
var _wdc_options = { bid_request:false,bid_timeout:false,bid_response:false,bid_won:false,bid_timing:false,bid_rollup:false,rollup_log:false,experiment: "" };
var _wdc_auction_counter = 0;
var _wdc_bid_history = {};

/**
 * This will enable sending data to google analytics. Only call once, or duplicate data will be sent!
 * @param  {object} provider use to set GA global (if renamed);
 * @param  {object} options use to configure adapter;
 * @return {[type]}    [description]
 */
exports.enableAnalytics = function ({ provider, options }) {
  _gaGlobal = provider || 'ga';
  _trackerSend = options && options.trackerName ? options.trackerName + '.send' : 'send';
  _sampled = typeof options === 'undefined' || typeof options.sampling === 'undefined' ||
             Math.random() < parseFloat(options.sampling);

  if (options && typeof options.global !== 'undefined') {
    _gaGlobal = options.global;
  }
  if (options && typeof options.enableDistribution !== 'undefined') {
    _enableDistribution = options.enableDistribution;
  }
  if (options && typeof options.wdc_options !== 'undefined') {
    for(var prop in _wdc_options) {
        _wdc_options[prop] = options.wdc_options[prop];
    }
  }

  var bid = null;

  if (_sampled) {
    // first send all events fired before enableAnalytics called

    var existingEvents = events.getEvents();

    utils._each(existingEvents, function (eventObj) {
      if (typeof eventObj !== 'object') {
        return;
      }
      var args = eventObj.args;

      if (eventObj.eventType === BID_REQUESTED) {
        bid = args;
        sendBidRequestToGa(bid);
      } else if (eventObj.eventType === BID_RESPONSE) {
        // bid is 2nd args
        bid = args;
        sendBidResponseToGa(bid);
      } else if (eventObj.eventType === BID_TIMEOUT) {
        const bidderArray = args;
        sendBidTimeouts(bidderArray);
      } else if (eventObj.eventType === BID_WON) {
        bid = args;
        sendBidWonToGa(bid);
      }
    });

    // Next register event listeners to send data immediately

    // bidRequests
    events.on(BID_REQUESTED, function (bidRequestObj) {
      sendBidRequestToGa(bidRequestObj);
    });

    // bidResponses
    events.on(BID_RESPONSE, function (bid) {
      sendBidResponseToGa(bid);
    });

    // bidTimeouts
    events.on(BID_TIMEOUT, function (bidderArray) {
      sendBidTimeouts(bidderArray);
    });

    // wins
    events.on(BID_WON, function (bid) {
      sendBidWonToGa(bid);
    });

    events.on(AUCTION_INIT, function () {
	initRollupMetrics();
    });

    events.on(AUCTION_END, function () {
	sendRollupMetricsToGa();
    });
  } else {
    utils.logMessage('Prebid.js google analytics disabled by sampling');
  }

  // finally set this function to return log message, prevents multiple adapter listeners
  this.enableAnalytics = function _enable() {
    return utils.logMessage(`Analytics adapter already enabled, unnecessary call to \`enableAnalytics\`.`);
  };
};

exports.getTrackerSend = function getTrackerSend() {
  return _trackerSend;
};

/**
 * Check if gaGlobal or window.ga is defined on page. If defined execute all the GA commands
 */
function checkAnalytics() {
  if (_enableCheck && typeof window[_gaGlobal] === 'function') {
    for (var i = 0; i < _analyticsQueue.length; i++) {
      _analyticsQueue[i].call();
    }

    // override push to execute the command immediately from now on
    _analyticsQueue.push = function (fn) {
      fn.call();
    };

    // turn check into NOOP
    _enableCheck = false;
  }

  utils.logMessage('event count sent to GA: ' + _eventCount);
}

function convertToCents(dollars) {
  if (dollars) {
    return Math.floor(dollars * 100);
  }

  return 0;
}

function getLoadTimeDistribution(time) {
  var distribution;
  if (time >= 0 && time < 200) {
    distribution = '0-200ms';
  } else if (time >= 200 && time < 300) {
    distribution = '0200-300ms';
  } else if (time >= 300 && time < 400) {
    distribution = '0300-400ms';
  } else if (time >= 400 && time < 500) {
    distribution = '0400-500ms';
  } else if (time >= 500 && time < 600) {
    distribution = '0500-600ms';
  } else if (time >= 600 && time < 800) {
    distribution = '0600-800ms';
  } else if (time >= 800 && time < 1000) {
    distribution = '0800-1000ms';
  } else if (time >= 1000 && time < 1200) {
    distribution = '1000-1200ms';
  } else if (time >= 1200 && time < 1500) {
    distribution = '1200-1500ms';
  } else if (time >= 1500 && time < 2000) {
    distribution = '1500-2000ms';
  } else if (time >= 2000) {
    distribution = '2000ms above';
  }

  return distribution;
}

function getCpmDistribution(cpm) {
  var distribution;
  if (cpm >= 0 && cpm < 0.5) {
    distribution = '$0-0.5';
  } else if (cpm >= 0.5 && cpm < 1) {
    distribution = '$0.5-1';
  } else if (cpm >= 1 && cpm < 1.5) {
    distribution = '$1-1.5';
  } else if (cpm >= 1.5 && cpm < 2) {
    distribution = '$1.5-2';
  } else if (cpm >= 2 && cpm < 2.5) {
    distribution = '$2-2.5';
  } else if (cpm >= 2.5 && cpm < 3) {
    distribution = '$2.5-3';
  } else if (cpm >= 3 && cpm < 4) {
    distribution = '$3-4';
  } else if (cpm >= 4 && cpm < 6) {
    distribution = '$4-6';
  } else if (cpm >= 6 && cpm < 8) {
    distribution = '$6-8';
  } else if (cpm >= 8) {
    distribution = '$8 above';
  }

  return distribution;
}

function sendBidRequestToGa(bid) {
  if (_wdc_options.bid_request && bid && bid.bidderCode) {
    _analyticsQueue.push(function () {
      _eventCount++;
      window[_gaGlobal](_trackerSend, 'event', _category, 'Requests', bid.bidderCode, 1, _disableInteraction);
    });
  }

  // check the queue
  checkAnalytics();
}

function sendBidResponseToGa(bid) {
  if (bid && bid.bidderCode) {
    var cpmCents = convertToCents(bid.cpm);
    var bidder = bid.bidderCode;
    if (_wdc_options.bid_response) {
      _analyticsQueue.push(function () {
        if (_wdc_options.bid_timing && typeof bid.timeToRespond !== 'undefined' && _enableDistribution) {
          _eventCount++;
          var dis = getLoadTimeDistribution(bid.timeToRespond);
          window[_gaGlobal](_trackerSend, 'event', 'Prebid.js Load Time Distribution', dis, bidder, 1, _disableInteraction);
        }

        if (bid.cpm > 0) {
          _eventCount = _eventCount + 2;
          var cpmDis = getCpmDistribution(bid.cpm);
          if (_enableDistribution) {
            _eventCount++;
            window[_gaGlobal](_trackerSend, 'event', 'Prebid.js CPM Distribution', cpmDis, bidder, 1, _disableInteraction);
          }
          window[_gaGlobal](_trackerSend, 'event', _category, 'Bids', bidder, cpmCents, _disableInteraction);
        }
      });
    }

    if (_wdc_options.bid_timing) {
      _analyticsQueue.push(function () {
        window[_gaGlobal](_trackerSend, 'event', _category, 'Bid Load Time', bidder, bid.timeToRespond, _disableInteraction);
      });
    }

    if(_wdc_options.bid_rollup) {
      if(!(bid.adUnitCode in _wdc_bid_history) || _wdc_bid_history[bid.adUnitCode]<bid.cpm) {
         _wdc_bid_history[bid.adUnitCode] = bid.cpm;
      }
    }
  }
  // check the queue
  checkAnalytics();
}

function sendBidTimeouts(timedOutBidders) {
  if(_wdc_options.bid_timeout) {
    _analyticsQueue.push(function () {
      utils._each(timedOutBidders, function (bidderCode) {
        _eventCount++;
        window[_gaGlobal](_trackerSend, 'event', _category, 'Timeouts', bidderCode, _disableInteraction);
      });
    });
  }
  checkAnalytics();
}

function sendBidWonToGa(bid) {
  if(_wdc_options.bid_won) {
    var cpmCents = convertToCents(bid.cpm);
    _analyticsQueue.push(function () {
      _eventCount++;
      window[_gaGlobal](_trackerSend, 'event', _category, 'Wins', bid.bidderCode, cpmCents, _disableInteraction);
    });
  }
  checkAnalytics();
}

function initRollupMetrics() {
  WDC.log.debug("AUCTION INIT",_wdc_bid_history,_wdc_auction_counter,_wdc_options);
}

function sendRollupMetricsToGa() {
  WDC.log.debug("AUCTION ENDED",_wdc_bid_history,_wdc_auction_counter);
  if(_wdc_options.bid_rollup) {
    var sum = 0;
    for(var prop in _wdc_bid_history) {
      if(_wdc_bid_history.hasOwnProperty(prop) && prop.match(/gpt-ad/) != null) sum += _wdc_bid_history[prop];
    }
    _wdc_auction_counter++;
    WDC.log.debug("SENDING BID HISTORY",_wdc_bid_history,sum,_wdc_auction_counter); 
    _wdc_bid_history = {};
    _analyticsQueue.push(function () {
      _eventCount++;
      window[_gaGlobal](_trackerSend, 'event', "WDC_PREBID", 'Bid Round Total' + (_wdc_options.experiment ? " " + _wdc_options.experiment : ""), _wdc_auction_counter, convertToCents(sum), _disableInteraction);
    });
    checkAnalytics();
  }
  if(_wdc_options.rollup_log) {
    (function() {
      var responses = pbjs.getBidResponses();
      var winners = pbjs.getAllWinningBids();
      var output = [];
      Object.keys(responses).forEach(function(adUnitCode) {
        var response = responses[adUnitCode];
        response.bids.forEach(function(bid) {
          output.push({
            bid: bid,
            adunit: adUnitCode,
            adId: bid.adId,
            bidder: bid.bidder,
            time: bid.timeToRespond,
            cpm: bid.cpm,
            msg: bid.statusMessage,
            rendered: !!winners.find(function(winner) {
              return winner.adId==bid.adId;
            })
          });
        });
      });
      if (output.length) {
        if (console.table) {
          console.table(output);
        } else {
          WDC.log.debug("AUCTION SUMMARY",output);
        }
      } else {
        WDC.log.warn('AUCTION HAD NO RESPONSES');
      }
    })();
  }

}

adaptermanager.registerAnalyticsAdapter({
  adapter: exports,
  code: 'ga'
});
