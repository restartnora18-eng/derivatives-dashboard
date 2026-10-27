import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import collect_oi_minutes as m
from collect_funding import DataError
NOW='2026-10-27T02:00:00.000Z'
MS=1793066100000
class MinuteOITests(unittest.TestCase):
 def test_exact_fields_zero_and_five_minute_alignment(self):
  r=m.normalize([str(MS),'100','1','80000'],'oi',NOW)
  self.assertEqual((r['contracts'],r['coin'],r['usd']),(100,1,80000))
  self.assertEqual(m.normalize([str(MS),'0','0','0'],'oi',NOW)['coin'],0)
  for raw in [[str(MS+60000),'100','1','80000'],[str(MS),'NaN','1','80000'],[str(MS),'-1','1','80000']]:
   with self.assertRaises(DataError):m.normalize(raw,'oi',NOW)
 def test_only_completed_candles_use_close_time_and_no_future_close(self):
  raw=[str(MS),'100','102','99','101','1'];r=m.normalize(raw,'prices',NOW)
  self.assertEqual(r['price'],101);self.assertEqual(int(m.parse_time(r['time']).timestamp()*1000),MS+300000)
  self.assertIsNone(m.normalize(raw[:-1]+['0'],'prices',NOW))
  with self.assertRaises(DataError):m.normalize([str(MS),'100','90','99','101','1'],'prices',NOW)
 def test_pagination_progress_overlapping_rows_and_incremental_stop(self):
  base=int(m.parse_time(NOW).timestamp()*1000)-300000
  raw=[[str(base-i*300000),'100','1','80000'] for i in range(100)]
  calls=[]
  def req(url,p):
   calls.append(dict(p));return {'code':'0','data':raw if len(calls)==1 else [raw[-1],[str(base-100*300000),'100','1','80000']]}
  rows,state=m.fetch('oi',[],{},NOW,req,lambda _:None)
  self.assertEqual(len(rows),101);self.assertEqual(len(calls),2);self.assertEqual(calls[1]['end'],str(int(raw[-1][0])-1));self.assertEqual(state['status'],'ok')
  calls.clear();rows,state=m.fetch('oi',[{'time':m.timestamp_ms(base-300000)}],{'backfill_finished':True},NOW,req,lambda _:None)
  self.assertEqual(len(calls),1)
 def test_stalled_pagination_and_errors_are_partial_not_silent_success(self):
  raw=[[str(MS-i*300000),'100','1','80000'] for i in range(100)]
  rows,state=m.fetch('oi',[],{},NOW,lambda u,p:{'code':'0','data':raw},lambda _:None)
  self.assertEqual(state['status'],'partial');self.assertEqual(state['code'],'pagination_stalled');self.assertEqual(len(rows),100)
 def test_failed_refresh_retains_saved_real_records(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);path=root/'data/oi-minutes/series.json';path.parent.mkdir(parents=True);r=m.normalize([str(MS),'100','1','80000'],'oi',NOW)
   path.write_text(json.dumps({'records':[r],'prices':[],'states':{}}))
   with patch.object(m,'utc_now',return_value=NOW),patch.object(m,'fetch',return_value=([],{'status':'failed','code':'http_403'})):
    result=m.collect(root)
   self.assertEqual(result['records'],[r]);self.assertEqual(result['states']['oi']['status'],'failed')
