import tempfile
import unittest
from unittest.mock import patch
import collect_price
from collect_funding import DataError, utc_now
from datetime import datetime,timezone

def payload(symbol='BTC', **fields):
    row=dict(instId=symbol+'-USDT-SWAP',instType='SWAP',markPx='80000',ts=str(int(datetime.now(timezone.utc).timestamp()*1000)))
    row.update(fields)
    return {'code':'0','data':[row]}

class PriceTests(unittest.TestCase):
    def test_price_contract_and_time_validation(self):
        now=utc_now()
        self.assertEqual(collect_price.normalize(payload(),'BTC',now)['price'],80000)
        for fields in [{'markPx':'0'},{'markPx':'-1'},{'markPx':'NaN'},{'ts':'1'},{'instId':'ETH-USDT-SWAP'}]:
            with self.subTest(fields=fields),self.assertRaises(DataError):
                collect_price.normalize(payload(**fields),'BTC',now)
    def test_failure_keeps_prior_real_price_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            stamp=str(int(datetime.now(timezone.utc).timestamp()*1000))
            with patch.object(collect_price,'get_json',side_effect=lambda url,p:payload(p['instId'].split('-')[0],ts=stamp)):
                collect_price.collect(directory)
                self.assertEqual(len(collect_price.collect(directory)['records']),2)
            with patch.object(collect_price,'get_json',side_effect=DataError('http_451','blocked')) as request:
                r=collect_price.collect(directory)
                self.assertEqual(request.call_count,1)
                self.assertEqual(len(r['records']),2)
                self.assertEqual(r['states']['BTC']['status'],'failed')
