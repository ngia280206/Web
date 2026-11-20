import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('Kaggle parser keeps full instructions, labels synthetic fields and rejects executable literals',()=>{
  const dir=mkdtempSync(join(tmpdir(),'recipe-parser-'));
  try{
    const file=join(dir,'recipes.csv');
    const quote=value=>'"'+value.replaceAll('"','""')+'"';
    const instructions='x'.repeat(2500);
    writeFileSync(file,',Title,Instructions,Image_Name,Cleaned_Ingredients\n'+[0,'Recipe',instructions,'image_name',"['salt', 'pepper']"].map(v=>quote(String(v))).join(',')+'\n'+[1,'Bad recipe','test','image',"__import__('os').getcwd()"].map(v=>quote(String(v))).join(',')+'\n','utf8');
    const result=spawnSync(process.env.PYTHON||'python',[fileURLToPath(new URL('../scripts/read-recipes.py',import.meta.url)),file],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    assert.equal(result.status,0);
    const rows=result.stdout.trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(rows[0].description.length,2000);assert.equal(rows[0].recipeInstructions.length,2500);
    assert.equal(rows[0].chefId,null);assert.equal(rows[0].imageUrl,null);assert.equal(rows[0].syntheticPrice,true);
    assert.deepEqual(rows[0].recipeIngredients,['salt','pepper']);assert.equal(rows[1].valid,false);
  }finally{rmSync(dir,{recursive:true});}
});
