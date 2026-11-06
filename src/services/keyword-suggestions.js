const KEYWORD_ALIASES = new Map([
  ['accuplacer', ['Accuplacer test', 'Accuplacer practice test']],
  ['ap psychology', ['AP Psych', 'AP Psychology exam']],
  ['ap u.s. history', ['APUSH', 'AP US History', 'AP U.S. History exam']],
  ['ap world history', ['AP World', 'AP World History exam']],
  ['asvab', ['ASVAB test', 'ASVAB practice test']],
  ['aswb', ['ASWB exam', 'ASWB practice test']],
  [
    'australian citizenship',
    ['Australian citizenship test', 'Australian citizenship practice test']
  ],
  [
    'aws cerified sysops administrator (soa-c02)',
    ['AWS Certified SysOps Administrator', 'AWS SOA-C02', 'SOA-C02']
  ],
  ['aws certified developer (dva-c02)', ['AWS Certified Developer', 'AWS DVA-C02', 'DVA-C02']],
  [
    'aws certified solutions architect (saa - c03)',
    ['SAA-C03', 'AWS SAA', 'AWS CSA', 'AWS Certified Solutions Architect']
  ],
  ['aws cloud practitioner (clf - c02)', ['AWS Cloud Practitioner', 'AWS CLF-C02', 'CLF-C02']],
  ['azure fundamentals (az - 900)', ['AZ-900', 'Azure Fundamentals', 'Microsoft AZ-900']],
  ['canadian citizenship', ['Canadian citizenship test', 'Canada citizenship test']],
  ['capm', ['CAPM exam', 'Certified Associate in Project Management']],
  ['cast', ['CAST exam', 'Certified Associate in Software Testing']],
  ['cbest', ['CBEST exam', 'CBEST practice test']],
  ['ccat', ['CCAT test', 'CCAT practice test']],
  ['ccna', ['Cisco CCNA', 'Cisco Certified Network Associate']],
  ['ccsp', ['Certified Cloud Security Professional', 'CCSP exam']],
  ['cdl', ['CDL permit test', 'Commercial Driver License test']],
  ['ceh', ['Certified Ethical Hacker', 'CEH exam']],
  ['cen', ['Certified Emergency Nurse', 'CEN exam']],
  ['cfa level 1', ['CFA Level I', 'CFA Level 1 exam']],
  ['cfa level 2', ['CFA Level II', 'CFA Level 2 exam']],
  ['chspe', ['CHSPE test', 'CHSPE practice test']],
  ['cisa', ['Certified Information Systems Auditor', 'CISA exam']],
  ['cissp', ['Certified Information Systems Security Professional', 'CISSP exam']],
  ['cna', ['Certified Nursing Assistant', 'CNA exam']],
  ['code de la route', ['Code de la route examen', 'Code de la route test']],
  ['comptia', ['CompTIA certification practice test', 'CompTIA exam']],
  ['comptia cysa+', ['CompTIA CySA Plus', 'CySA+ exam', 'CompTIA Cybersecurity Analyst']],
  ['comptia linux+', ['CompTIA Linux Plus', 'Linux+ exam']],
  ['comptia project+', ['CompTIA Project Plus', 'Project+ exam']],
  ['comptia security+', ['CompTIA Security Plus', 'Security+ exam']],
  ['comptia tech+', ['CompTIA Tech Plus', 'Tech+ exam']],
  ['cosmetology', ['Cosmetology state board exam', 'Cosmetology practice test']],
  ['cpa', ['Certified Public Accountant exam', 'CPA practice test']],
  ['cpce', ['CPCE exam', 'Counselor Preparation Comprehensive Examination']],
  ['cst', ['Certified Surgical Technologist', 'CST exam']],
  ['dat', ['Dental Admission Test', 'DAT practice test']],
  ['dkt', ['Driver Knowledge Test', 'DKT practice test']],
  ['dmv', ['DMV permit practice test', 'DMV written test']],
  ['driving faqs', ['Driving test questions', 'Driving practice test']],
  ['driving signs', ['Road signs test', 'Driving signs practice test']],
  ['driving theory', ['Driving theory test', 'Theory test practice']],
  ['emt-b', ['EMT Basic', 'Emergency Medical Technician Basic', 'EMT-B practice test']],
  ['epa 608', ['EPA Section 608', 'EPA 608 practice test']],
  ['fsc', ['Firearm Safety Certificate test', 'FSC practice test']],
  ['fsot', ['Foreign Service Officer Test', 'FSOT practice test']],
  ['g1', ['Ontario G1 test', 'G1 written test']],
  ['ged', ['GED test', 'GED practice test']],
  ['gre', ['GRE test prep', 'GRE practice test']],
  ['ham radio', ['Amateur radio license exam', 'Ham radio practice test']],
  ['hesi a2', ['HESI Admission Assessment', 'HESI A2 practice test']],
  ['hiset', ['HiSET test', 'HiSET practice test']],
  ['hspt', ['High School Placement Test', 'HSPT practice test']],
  ['hvac', ['HVAC certification exam', 'HVAC practice test']],
  ['java se 17 developer', ['Java 17 certification', 'Oracle Java SE 17 Developer exam']],
  [
    'journeyman electrician test',
    ['Journeyman electrician exam', 'Electrician journeyman practice test']
  ],
  ['mbe', ['Multistate Bar Examination', 'MBE practice questions']],
  ['mblex', ['Massage and Bodywork Licensing Examination', 'MBLEx practice test']],
  ['mcat', ['Medical College Admission Test', 'MCAT practice test']],
  ['motorcycle', ['Motorcycle permit test', 'Motorcycle practice test']],
  ['naplex', ['North American Pharmacist Licensure Examination', 'NAPLEX practice test']],
  ['nasm', ['NASM Certified Personal Trainer exam', 'NASM CPT practice test']],
  ['nate', ['North American Technician Excellence', 'NATE certification practice test']],
  ['nce', ['National Counselor Examination', 'NCE practice test']],
  ['nclex-pn', ['NCLEX PN', 'NCLEX Practical Nursing', 'NCLEX-PN practice test']],
  ['nclex-rn', ['NCLEX RN', 'NCLEX Registered Nurse', 'NCLEX-RN practice test']],
  ['nmls', ['NMLS exam', 'SAFE Mortgage Loan Originator test']],
  ['paramedic', ['Paramedic certification exam', 'Paramedic practice test']],
  ['parapro', ['ParaPro Assessment', 'ParaPro practice test']],
  ['part 107', ['FAA Part 107', 'Part 107 drone test']],
  ['pccn', ['Progressive Care Certified Nurse', 'PCCN practice test']],
  ['permit', ['Permit practice test', 'Learner permit test']],
  ['pert', ['Postsecondary Education Readiness Test', 'PERT practice test']],
  ['phlebotomy', ['Phlebotomy certification exam', 'Phlebotomy practice test']],
  ['phr', ['Professional in Human Resources', 'PHR certification exam']],
  ['pl-300', ['Microsoft PL-300', 'Power BI Data Analyst Associate', 'PL-300 practice test']],
  ['pmp', ['Project Management Professional', 'PMP practice test']],
  ['praxis core', ['Praxis Core Academic Skills', 'Praxis Core practice test']],
  ['ptce', ['Pharmacy Technician Certification Exam', 'PTCE practice test']],
  ['real estate', ['Real estate license exam', 'Real estate practice test']],
  ['series7', ['Series 7 exam', 'FINRA General Securities Representative exam']],
  ['servsafe', ['ServSafe exam', 'ServSafe food handler test']],
  ['sie', ['Securities Industry Essentials', 'SIE practice test']],
  ['sscp', ['Systems Security Certified Practitioner', 'SSCP exam']],
  ['tabe', ['TABE test', 'Test of Adult Basic Education']],
  ['tasc', ['TASC test', 'TASC practice test']],
  ['teas', ['Test of Essential Academic Skills', 'TEAS practice test']],
  ['tsi', ['Texas Success Initiative Assessment', 'TSI practice test']],
  ['usmle', ['United States Medical Licensing Examination', 'USMLE practice questions']],
  ['vtne', ['Veterinary Technician National Examination', 'VTNE practice test']],
  [
    'wastewater operator',
    ['Wastewater operator certification exam', 'Wastewater treatment operator test']
  ],
  ['wonderlic', ['Wonderlic test', 'Wonderlic practice test']],
  ['worksheetzone: ai quiz maker', ['Worksheetzone AI Quiz Maker', 'Worksheet Zone']]
]);

const SHORT_KEYWORD_ALIASES = new Map([
  ['asvab', ['ASVAB test']],
  ['aswb', ['ASWB test']],
  ['gre', ['GRE test']],
  ['cen', ['CEN nurse']],
  ['nasm', ['NASM CPT']],
  ['teas', ['TEAS test']],
  ['ccna', ['CCNA Cisco']],
  ['cisa', ['CISA certification']],
  ['cissp', ['CISSP certification']],
  ['cfa level 1', ['CFA Level I']],
  ['cfa level 2', ['CFA Level II']],
  ['nclex-pn', ['NCLEX PN']],
  ['nclex-rn', ['NCLEX RN']],
  ['comptia a+', ['CompTIA A Plus']],
  ['comptia network+', ['CompTIA Network Plus']],
  ['comptia linux+', ['CompTIA Linux Plus']],
  ['comptia security+', ['CompTIA Security Plus']]
]);

function suggestKeywords(appName) {
  const name = String(appName || '').trim();
  const key = name.toLowerCase();
  const shortAliases = SHORT_KEYWORD_ALIASES.get(key);
  if (shortAliases) return shortAliases;
  const aliases = KEYWORD_ALIASES.get(key) || [];
  // Với tên ngắn, chỉ nhận biến thể ngắn gọn; không mở rộng CEH thành tên chứng chỉ dài.
  const filtered = aliases.filter(
    keyword =>
      !/\b(practice|exam|test prep|test questions|written test|permit test|certification test)\b/i.test(
        keyword
      )
  );
  if (key === 'ceh') return [];
  return [...new Set(filtered)].slice(0, 3);
}

function defaultKeywordsForApp(appName, cmsKeywords = [], storeNameKeywords = []) {
  const name = String(appName || '').trim();
  const aliases = suggestKeywords(name);
  // Với tên ngắn, giữ nguyên tên/mã làm từ khóa chính (CEH vẫn chỉ là CEH).
  // Với tên dài, ưu tiên mã viết tắt và các biến thể dễ nhận diện.
  const storeNames =
    name.toLowerCase() === 'ceh' ? [] : Array.isArray(storeNameKeywords) ? storeNameKeywords : [];
  const candidates =
    name.length <= 20
      ? [name, ...aliases, ...storeNames]
      : [...aliases, ...(Array.isArray(cmsKeywords) ? cmsKeywords : []), ...storeNames, name];
  const unique = [...new Set(candidates.map(value => String(value || '').trim()).filter(Boolean))];
  return unique.slice(0, 3);
}

module.exports = { suggestKeywords, defaultKeywordsForApp };
