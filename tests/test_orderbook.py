import tempfile,unittest
from datetime import datetime,timezone
from unittest.mock import patch
import collect_orderbook
from collect_funding import DataError,utc_now

def fixture(symbol='BTC',n=30):
 i={'code':'0','data':[{'instId':symbol+'-USDT-SWAP','instType':'SWAP','ctType':'linear','ctValCcy':symbol,'ctVal':'.01','ctMult':'1','settleCcy':'USDT','state':'live'}]}
 b={'code':'0','data':[{'ts':str(int(datetime.now(timezone.utc).timestamp()*1000)),'bids':[[str(99.99-j*.01),'10','0','1'] for j in range(n)],'asks':[[str(100.01+j*.01),'5','0','1'] for j in range(n)]}]}
 return i,b
class BookTests(unittest.TestCase):
 def test_contract_conversion_spread_and_covered_band_imbalance(self):
  i,b=fixture();r=collect_orderbook.normalize(i,b,'BTC',utc_now())
  self.assertAlmostEqual(r['spread_bps'],2)
  self.assertAlmostEqual(r['bids'][0]['coin'],.1)
  self.assertAlmostEqual(r['bids'][0]['notional'],9.999)
  self.assertTrue(r['bands']['10']['covered']);self.assertFalse(r['bands']['50']['covered']);self.assertIsNone(r['bands']['50']['imbalance_pct']);self.assertGreater(r['top20_imbalance_pct'],0)
 def test_no_partial_band_or_too_short_book_is_claimed_complete(self):
  i,b=fixture(n=1);r=collect_orderbook.normalize(i,b,'BTC',utc_now());self.assertIsNone(r['top20_imbalance_pct']);self.assertTrue(all(not v['covered'] and v['imbalance_pct'] is None for v in r['bands'].values()))
 def test_crossed_sorted_zero_wrong_unit_and_multiplier_are_rejected(self):
  for kind in ['crossed','sort','zero','unit','mult','stale']:
   i,b=fixture()
   if kind=='crossed':b['data'][0]['asks'][0][0]='99'
   if kind=='sort':b['data'][0]['bids'][1][0]='101'
   if kind=='zero':b['data'][0]['bids'][0][1]='0'
   if kind=='unit':i['data'][0]['ctValCcy']='USDT'
   if kind=='mult':i['data'][0]['ctMult']='2'
   if kind=='stale':b['data'][0]['ts']='1'
   with self.subTest(kind=kind),self.assertRaises(DataError):collect_orderbook.normalize(i,b,'BTC',utc_now())
 def test_failure_retains_snapshot_but_history_does_not_store_levels(self):
  fixtures={s:fixture(s) for s in ('BTC','ETH')}
  def req(url,p):return fixtures[p['instId'].split('-')[0]][0 if url.endswith('instruments') else 1]
  with tempfile.TemporaryDirectory() as directory:
   with patch.object(collect_orderbook,'get_json',side_effect=req):first=collect_orderbook.collect(directory)
   self.assertEqual(len(first['records']),2);self.assertNotIn('bids',first['records'][0])
   with patch.object(collect_orderbook,'get_json',side_effect=DataError('http_403','blocked')) as request:second=collect_orderbook.collect(directory);self.assertEqual(request.call_count,1)
   self.assertEqual(first['snapshots'],second['snapshots']);self.assertEqual(len(second['records']),2)
