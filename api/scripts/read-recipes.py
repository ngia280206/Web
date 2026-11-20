"""Safe CSV/Python-literal decoding; never eval dataset content."""
import ast, csv, hashlib, json, sys
from pathlib import Path

p=Path(sys.argv[1])
with p.open(encoding='utf-8-sig',newline='') as stream:
    reader=csv.DictReader(stream)
    required={'Title','Instructions','Image_Name','Cleaned_Ingredients'}
    if not required.issubset(reader.fieldnames or []): raise ValueError('Unexpected dataset columns')
    for index,row in enumerate(reader):
        try:
            values=ast.literal_eval(row.get('Cleaned_Ingredients') or '[]')
            if not isinstance(values,list) or not all(isinstance(v,str) for v in values): raise ValueError('Invalid ingredient list')
            title=(row.get('Title') or '').strip()
            instructions=(row.get('Instructions') or '').strip()
            if not title or len(title)>120 or not instructions: raise ValueError('Missing/oversized title or missing instructions')
            source_id=row.get('') or hashlib.sha256((title+'\n'+instructions).encode()).hexdigest()
            print(json.dumps({'valid':True,'sourceId':str(source_id),'name':title,'description':instructions[:2000],
                'recipeInstructions':instructions,'recipeIngredients':values,'imageName':row.get('Image_Name') or '',
                'source':'kaggle','price':0,'syntheticPrice':True,'category':'Công thức Kaggle (chưa phân loại)',
                'syntheticCategory':True,'available':False,'chefId':None,'imageUrl':None},ensure_ascii=False))
        except (ValueError,SyntaxError,TypeError): print(json.dumps({'valid':False,'row':index+2,'reason':'invalid fields or ingredient literal'}))
