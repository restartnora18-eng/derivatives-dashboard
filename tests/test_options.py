import tempfile,unittest
from datetime import datetime,timezone,timedelta
from unittest.mock import patch
import collect_options
from collect_funding import utc_now,DataError

def fixture(symbol='BTC'):
 expiry=str(int((datetime.now(timezone.utc)+timedelta(days=30)).timestamp()*1000));ts=str(int(datetime.now(timezone.utc).timestamp()*1000));ins=[];summ=[]
 for strike,opt,delta,iv in [(100,'C',.5,.4),(100,'P',-.5,.42),(110,'C',.25,.38),(90,'P',-.25,.46)]:
  name=f'{symbol}-USD-TEST-{strike}-{opt}'
  ins.append({'instId':name,'instType':'OPTION','instFamily':symbol+'-USD','settleCcy':symbol,'state':'live','optType':opt,'expTime':expiry,'stk':str(strike)})
  summ.append({'instId':name,'instType':'OPTION','fwdPx':'100','markVol':str(iv),'bidVol':'.3','askVol':'.5','deltaBS':str(delta),'ts':ts})
 return {'code':'0','data':ins},{'code':'0','data':summ}
class OptionsTests(unittest.TestCase):
 def test_decimal_iv_conversion_same_strike_atm_and_call_minus_put_rr(self):
  i,s=fixture();result,_=collect_options.calculate(i,s,'BTC',utc_now());self.assertEqual(len(result),1)
  self.assertAlmostEqual(result[0]['atm_iv_pct'],41);self.assertAlmostEqual(result[0]['rr25_proxy_pp'],-8)
  self.assertEqual(result[0]['atm_strike'],100)
 def test_missing_delta_leg_is_missing_not_zero_or_interpolated(self):
  i,s=fixture();s['data'][2]['deltaBS']='.1';r,_=collect_options.calculate(i,s,'BTC',utc_now());self.assertIsNone(r[0]['rr25_proxy_pp'])
 def test_bad_units_stale_crossed_quotes_and_wrong_family_rejected(self):
  for kind in ['stale','crossed','nan','family','delta']:
   i,s=fixture();ins=i['data'][0];q=s['data'][0]
   if kind=='stale':q['ts']='1'
   if kind=='crossed':q['bidVol']='.8'
   if kind=='nan':q['markVol']='NaN'
   if kind=='family':ins['instFamily']='BTC-USDT'
   if kind=='delta':q['deltaBS']='-.5'
   with self.subTest(kind=kind),self.assertRaises(DataError):collect_options.quote(ins,q,'BTC',utc_now())
 def test_a_failed_run_preserves_expiry_history_and_snapshot(self):
  fixtures={s:fixture(s) for s in ['BTC','ETH']}
  def request(url,params):return fixtures[params['instFamily'].split('-')[0]][0 if url.endswith('instruments') else 1]
  with tempfile.TemporaryDirectory() as directory:
   with patch.object(collect_options,'get_json',side_effect=request):first=collect_options.collect(directory)
   self.assertEqual(len(first['records']),2)
   with patch.object(collect_options,'get_json',side_effect=DataError('http_403','blocked')) as req:second=collect_options.collect(directory);self.assertEqual(req.call_count,1)
   self.assertEqual(first['snapshots'],second['snapshots']);self.assertEqual(len(second['records']),2)
