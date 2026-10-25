import tempfile,unittest
from datetime import datetime,timezone
from unittest.mock import patch
import collect_liquidations
from collect_funding import DataError,utc_now

def fixture(symbol='BTC'):
 t=str(int(datetime.now(timezone.utc).timestamp()*1000))
 d={'ts':t,'posSide':'long','side':'sell','bkPx':'100.0','sz':'1.00'}
 return {'code':'0','data':[{'instId':symbol+'-USDT-SWAP','instType':'SWAP','details':[d]}]}
class LiquidationTests(unittest.TestCase):
 def test_normalizes_numeric_fingerprint_without_fabricating_notional(self):
  p=fixture();p['data'][0]['details'].append(dict(p['data'][0]['details'][0],sz='1',bkPx='100'))
  rs,info=collect_liquidations.normalize(p,'BTC',utc_now());self.assertEqual(len(rs),1);self.assertEqual(info['returned'],2);self.assertNotIn('notional',rs[0])
 def test_rejects_future_wrong_direction_and_bad_price_but_empty_is_valid(self):
  for kind in ['future','side','price']:
   p=fixture();r=p['data'][0]['details'][0]
   if kind=='future':r['ts']=str(int(r['ts'])+3600000)
   if kind=='side':r['side']='buy'
   if kind=='price':r['bkPx']='NaN'
   rs,info=collect_liquidations.normalize(p,'BTC',utc_now());self.assertEqual(rs,[]);self.assertEqual(info['rejected'],1)
  self.assertEqual(collect_liquidations.normalize({'code':'0','data':[]},'BTC',utc_now())[0],[])
 def test_wrong_contract_fails_and_capped_return_is_disclosed(self):
  with self.assertRaises(DataError):collect_liquidations.normalize(fixture('ETH'),'BTC',utc_now())
  p=fixture();p['data'][0]['details']*=100
  rs,info=collect_liquidations.normalize(p,'BTC',utc_now());self.assertTrue(info['limit_reached']);self.assertEqual(len(rs),1)
 def test_repeated_fetch_adds_zero_new_samples_and_failure_retains_events(self):
  fixtures={s:fixture(s) for s in ('BTC','ETH')}
  with tempfile.TemporaryDirectory() as directory:
   with patch.object(collect_liquidations,'get_json',side_effect=lambda u,p:fixtures[p['uly'].split('-')[0]]):
    first=collect_liquidations.collect(directory);second=collect_liquidations.collect(directory)
   self.assertEqual(len(first['records']),2);self.assertEqual(len(second['records']),2);self.assertEqual(second['states']['BTC']['new_observed'],0)
   with patch.object(collect_liquidations,'get_json',side_effect=DataError('http_451','blocked')) as req:third=collect_liquidations.collect(directory);self.assertEqual(req.call_count,1)
   self.assertEqual(second['records'],third['records']);self.assertEqual(second['attempts'],third['attempts'])
