import { expect } from 'chai';
import { spec } from 'modules/sovrnBidAdapter';
import { newBidder } from 'src/adapters/bidderFactory';
import { REPO_AND_VERSION } from 'src/constants';

const ENDPOINT = `//ap.lijit.com/rtb/bid?src=${REPO_AND_VERSION}`;

describe('sovrnBidAdapter', function() {
  const adapter = newBidder(spec);

  describe('isBidRequestValid', () => {
    let bid = {
      'bidder': 'sovrn',
      'params': {
        'tagid': '403370'
      },
      'adUnitCode': 'adunit-code',
      'sizes': [
        [300, 250]
      ],
      'bidId': '30b31c1838de1e',
      'bidderRequestId': '22edbae2733bf6',
      'auctionId': '1d1a030790a475',
    };

    it('should return true when required params found', () => {
      expect(spec.isBidRequestValid(bid)).to.equal(true);
    });

    it('should return false when tagid not passed correctly', () => {
      bid.params.tagid = 'ABCD';
      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });

    it('should return false when require params are not passed', () => {
      let bid = Object.assign({}, bid);
      bid.params = {};
      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });
  });

  describe('buildRequests', () => {
    const bidRequests = [{
      'bidder': 'sovrn',
      'params': {
        'tagid': '403370'
      },
      'adUnitCode': 'adunit-code',
      'sizes': [
        [300, 250]
      ],
      'bidId': '30b31c1838de1e',
      'bidderRequestId': '22edbae2733bf6',
      'auctionId': '1d1a030790a475'
    }];

    const request = spec.buildRequests(bidRequests);

    it('sends bid request to our endpoint via POST', () => {
      expect(request.method).to.equal('POST');
    });

    it('attaches source and version to endpoint URL as query params', () => {
      expect(request.url).to.equal(ENDPOINT)
    });

    it('sends \'iv\' as query param if present', () => {
      const ivBidRequests = [{
        'bidder': 'sovrn',
        'params': {
          'tagid': '403370',
          'iv': 'vet'
        },
        'adUnitCode': 'adunit-code',
        'sizes': [
          [300, 250]
        ],
        'bidId': '30b31c1838de1e',
        'bidderRequestId': '22edbae2733bf6',
        'auctionId': '1d1a030790a475'
      }];
      const request = spec.buildRequests(ivBidRequests);

      expect(request.url).to.contain('iv=vet')
    });

    it('sends gdpr info if exists', () => {
      let consentString = 'BOJ8RZsOJ8RZsABAB8AAAAAZ+A==';
      let bidderRequest = {
        'bidderCode': 'sovrn',
        'auctionId': '1d1a030790a475',
        'bidderRequestId': '22edbae2733bf6',
        'timeout': 3000,
        'gdprConsent': {
          consentString: consentString,
          gdprApplies: true
        }
      };
      bidderRequest.bids = bidRequests;

      const request = spec.buildRequests(bidRequests, bidderRequest);
      const payload = JSON.parse(request.data);

      expect(payload.regs.ext.gdpr).to.exist.and.to.be.a('number');
      expect(payload.regs.ext.gdpr).to.equal(1);
      expect(payload.user.ext.consent).to.exist.and.to.be.a('string');
      expect(payload.user.ext.consent).to.equal(consentString);
    });

    it('converts tagid to string', () => {
      const ivBidRequests = [{
        'bidder': 'sovrn',
        'params': {
          'tagid': 403370,
          'iv': 'vet'
        },
        'adUnitCode': 'adunit-code',
        'sizes': [
          [300, 250]
        ],
        'bidId': '30b31c1838de1e',
        'bidderRequestId': '22edbae2733bf6',
        'auctionId': '1d1a030790a475'
      }];
      const request = spec.buildRequests(ivBidRequests);

      expect(request.data).to.contain('"tagid":"403370"')
    })
  });

  describe('interpretResponse', () => {
    let response;
    beforeEach(() => {
      response = {
        body: {
          'id': '37386aade21a71',
          'seatbid': [{
            'bid': [{
              'id': 'a_403370_332fdb9b064040ddbec05891bd13ab28',
              'crid': 'creativelycreatedcreativecreative',
              'impid': '263c448586f5a1',
              'price': 0.45882675,
              'nurl': '<!-- NURL -->',
              'adm': '<!-- Creative -->',
              'h': 90,
              'w': 728
            }]
          }]
        }
      };
    });

    it('should get the correct bid response', () => {
      let expectedResponse = [{
        'requestId': '263c448586f5a1',
        'cpm': 0.45882675,
        'width': 728,
        'height': 90,
        'creativeId': 'creativelycreatedcreativecreative',
        'dealId': null,
        'currency': 'USD',
        'netRevenue': true,
        'mediaType': 'banner',
        'ad': decodeURIComponent(`<!-- Creative --><img src=<!-- NURL -->>`),
        'ttl': 60000
      }];

      let result = spec.interpretResponse(response);
      expect(Object.keys(result[0])).to.deep.equal(Object.keys(expectedResponse[0]));
    });

    it('crid should default to the bid id if not on the response', () => {
      delete response.body.seatbid[0].bid[0].crid;
      let expectedResponse = [{
        'requestId': '263c448586f5a1',
        'cpm': 0.45882675,
        'width': 728,
        'height': 90,
        'creativeId': response.body.seatbid[0].bid[0].id,
        'dealId': null,
        'currency': 'USD',
        'netRevenue': true,
        'mediaType': 'banner',
        'ad': decodeURIComponent(`<!-- Creative --><img src=<!-- NURL -->>`),
        'ttl': 60000
      }];

      let result = spec.interpretResponse(response);
      expect(Object.keys(result[0])).to.deep.equal(Object.keys(expectedResponse[0]));
    });

    it('should get correct bid response when dealId is passed', () => {
      response.body.dealid = 'baking';

      let expectedResponse = [{
        'requestId': '263c448586f5a1',
        'cpm': 0.45882675,
        'width': 728,
        'height': 90,
        'creativeId': 'creativelycreatedcreativecreative',
        'dealId': 'baking',
        'currency': 'USD',
        'netRevenue': true,
        'mediaType': 'banner',
        'ad': decodeURIComponent(`<!-- Creative --><img src=<!-- NURL -->>`),
        'ttl': 60000
      }];

      let result = spec.interpretResponse(response);
      expect(Object.keys(result[0])).to.deep.equal(Object.keys(expectedResponse[0]));
    });

    it('handles empty bid response', () => {
      let response = {
        body: {
          'id': '37386aade21a71',
          'seatbid': []
        }
      };
      let result = spec.interpretResponse(response);
      expect(result.length).to.equal(0);
    });
  });
});
