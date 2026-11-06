import * as f from './format.js';
const eq=(a,b)=>{ if(JSON.stringify(a)!==JSON.stringify(b)){console.log('FAIL',a,'!=',b);process.exitCode=1}else console.log('ok',a)};
eq(f.euro(1.49),'1,49 €');
eq(f.unitPrice(6.9125,'kg'),'6,91 €/kg');
eq(f.pack({qty:0.96,unit:'kg'}),'960 g');
eq(f.pack({qty:60,unit:'g',count:3}),'3×60 g');
eq(f.pack({qty:1,unit:'l',count:6}),'6×1 l');
eq(f.pack({qty:1500,unit:'g'}),'1,5 kg');
eq(f.pack({perUnit:true,unit:'kg'}),'al kg');
eq(f.validUntil('2026-11-15'),'al 15/11');
eq(f.updatedAt('2026-11-06T07:30:00',new Date('2026-11-06T12:00:00')),'oggi 07:30');
eq(f.updatedAt('2026-11-05T13:30:00',new Date('2026-11-06T12:00:00')),'ieri 13:30');
eq(f.discountLabel(1.99,2.99),'−33%');
eq(f.savingPct(6.91,11.06),38);
eq(f.diffLabel(9.37,6.91),'+36%');
eq(f.diffLabel(6.91,6.91),'');
eq(f.savingEuro({bestUnit:6.91,worstUnit:11.06,bestPackQty:0.16,unit:'kg'}),{packs:4,euro:2.66});
eq(f.savingEuro({bestUnit:1,worstUnit:2,bestPackQty:0.5,unit:'kg'}).packs,1);
const tonno=[{name:'Tonno in olio di oliva Almare',unit:'kg',packQty:0.16,unitPrice:6.91},{name:"Tonno all'olio d'oliva Gran Mare",unit:'kg',packQty:0.96,unitPrice:9.37},{name:"Tonno pinna gialla all'olio di oliva Ondina",unit:'kg',packQty:0.18,unitPrice:11.06}];
eq(f.isReliableComparison(tonno),true);
eq(f.isReliableComparison([{name:'Vino rosso da tavola',unit:'l',packQty:1,unitPrice:2.05},{name:'Chianti DOCG',unit:'l',packQty:0.75,unitPrice:5.86}]),false);
eq(f.isReliableComparison([{name:'Olio extravergine',unit:'l',packQty:1,unitPrice:7},{name:'Olio di semi',unit:'l',packQty:1,unitPrice:2.5}]),false);
eq(f.sentenceCase('TONNO ALL\'OLIO  DI OLIVA'),"Tonno all'olio di oliva");
eq(f.sentenceCase('LATTE UHT INTERO'),'Latte UHT intero');
eq(f.normalizeCategory('GASTRONOMIA, SALUMI E FORMAGGI'),'Salumi e formaggi');
eq(f.normalizeCategory('Salumi e formaggi'),'Salumi e formaggi');
const v=f.listVerdict([
 {id:'tonno',name:'Tonno',offers:[{chain:'Aldi',unitPrice:6.91},{chain:'Penny',unitPrice:9.37},{chain:'Eurospin',unitPrice:11.06}]},
 {id:'latte',name:'Latte',offers:[{chain:'Aldi',unitPrice:0.99},{chain:'Penny',unitPrice:1.09}]},
 {id:'froll',name:'Frollini',offers:[{chain:'Aldi',unitPrice:2.98}]},
 {id:'caffe',name:'Caffè',offers:[{chain:'Eurospin',unitPrice:8.45},{chain:'Aldi',unitPrice:11.2}]},
 {id:'mozz',name:'Mozzarella',offers:[{chain:'Penny',unitPrice:5.3}]},
 {id:'burro',name:'Burro',offers:[]}]);
eq(v.winner,'Aldi'); eq(v.counts,{Aldi:3,Penny:1,Eurospin:1}); eq(v.inOffer,5); eq(v.missing.map(m=>m.id),['burro']);
eq(f.listVerdict([]).winner,null);
eq(f.isReliableComparison([{name:'Olio extra vergine di oliva',unit:'l',packQty:1,unitPrice:4.29},{name:'Olio EVO Desantis',unit:'l',packQty:0.75,unitPrice:5.32}]),true);
