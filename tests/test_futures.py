import tempfile
import unittest
from datetime import datetime,timezone,timedelta
from unittest.mock import patch
import collect_futures
from collect_funding import DataError,utc_now

def instrument(symbol='BTC',days=30):
 now=datetime.now(timezone.utc)
 return {'instId':symbol+'-USDT-TEST'+str(days),'instFamily':symbol+'-USDT','instType':'FUTURES','settleCcy':'USDT','ctType':'linear','state':'live','expTime':str(int((now+timedelta(days=days)).timestamp()*1000))}
def pair(inst,price=101,index=100):
 t=str(int(datetime.now(timezone.utc).timestamp()*1000));symbol=inst['instId'].split('-')[0]
 return {'instId':inst['instId'],'instType':'FUTURES','markPx':str(price),'ts':t},{'instId':symbol+'-USDT','idxPx':str(index),'ts':t}
class FuturesTests(unittest.TestCase):
 def test_selection_excludes_wrong_settlement_expired_and_caps_nearest_four(self):
  items=[instrument(days=d) for d in [180,90,30,14,7,-1]];wrong=instrument();wrong['settleCcy']='BTC';items.append(wrong)
  selected=collect_futures.select_contracts({'code':'0','data':items},'BTC',utc_now())
  self.assertEqual(len(selected),4)
  self.assertTrue(selected[0]['instId'].endswith('7'));self.assertTrue(selected[-1]['instId'].endswith('90'))
 def test_annualization_uses_fractional_actual_days_and_near_expiry_is_null(self):
  for days,price in [(30,101),(30,99),(.5,101)]:
   inst=collect_futures.select_contracts({'code':'0','data':[instrument(days=days)]},'BTC',utc_now())[0];mark,index=pair(inst,price)
   r=collect_futures.normalize(inst,mark,index,'BTC',utc_now())
   self.assertAlmostEqual(r['basis_pct'],price-100)
   if days<1:self.assertIsNone(r['annualized_pct'])
   else:self.assertAlmostEqual(r['annualized_pct'],(price-100)*365/30,places=4)
 def test_mismatch_nonfinite_and_skew_are_rejected(self):
  inst=collect_futures.select_contracts({'code':'0','data':[instrument()]},'BTC',utc_now())[0]
  for kind in ['mismatch','zero','skew','nan']:
   mark,index=pair(inst)
   if kind=='mismatch':index['instId']='BTC-USD'
   if kind=='zero':index['idxPx']='0'
   if kind=='nan':mark['markPx']='NaN'
   if kind=='skew':index['ts']=str(int(index['ts'])-150000)
   with self.subTest(kind=kind),self.assertRaises(DataError):collect_futures.normalize(inst,mark,index,'BTC',utc_now())
 def test_failed_refresh_retains_snapshot_and_history(self):
  fixtures={s:instrument(s) for s in ['BTC','ETH']}
  def request(url,params):
   symbol=params.get('instFamily',params.get('instId','')).split('-')[0];inst=fixtures[symbol]
   if url.endswith('instruments'):data=[inst]
   elif url.endswith('mark-price'):data=[pair(inst)[0]]
   else:data=[pair(inst)[1]]
   return {'code':'0','data':data}
  with tempfile.TemporaryDirectory() as directory:
   with patch.object(collect_futures,'get_json',side_effect=request):
    first=collect_futures.collect(directory);self.assertEqual(len(first['records']),2)
   with patch.object(collect_futures,'get_json',side_effect=DataError('http_403','blocked')) as req:
    second=collect_futures.collect(directory);self.assertEqual(req.call_count,1)
   self.assertEqual(first['snapshots'],second['snapshots']);self.assertEqual(second['states']['BTC']['status'],'failed')
