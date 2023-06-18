
// Functions from other modules
// The following functions are copy/pasted from other files due to issues with import/module support for workers. 
// They should be replaced with import statements once all browsers support this or an alternative is found. 

function round6(x) {
  return (Math.round(x * 1e6) / 1e6);
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

function getRandomAlphanum(num){
  let outArr = new Array(num);
  for(let i=0;i<num;i++){
    let intI = getRandomInt(1,62);
    if(intI <= 10){
      intI = intI + 47;
    } else if(intI <= 36){
      intI = intI - 10 + 64;
    } else {
      intI = intI - 36 + 96;
    }
    outArr[i] = String.fromCharCode(intI);
  }
  return outArr.join('');
}

// Sans/serif lookup for common font families
// Should be added to if additional fonts are encountered
const serifFonts = ["Baskerville", "Book", "Cambria", "Century_Schoolbook", "Courier", "Garamond", "Georgia", "Times"];
const sansFonts = ["Arial", "Calibri", "Comic", "Franklin", "Helvetica", "Impact", "Tahoma", "Trebuchet", "Verdana"];

const serifFontsRegex = new RegExp(serifFonts.reduce((x,y) => x + '|' + y), 'i');
const sansFontsRegex = new RegExp(sansFonts.reduce((x,y) => x + '|' + y), 'i');

// Given a font name from Tesseract/Abbyy XML, determine if it should be represented by sans font (Open Sans) or serif font (Libre Baskerville)
function determineSansSerif(fontName) {

  let fontFamily = "Default";
  // Font support is currently limited to 1 font for Sans and 1 font for Serif.
  if(fontName){
    // First, test to see if "sans" or "serif" is in the name of the font
    if(/(^|\W|_)sans($|\W|_)/i.test(fontName)){
      fontFamily = "Open Sans";
    } else if (/(^|\W|_)serif($|\W|_)/i.test(fontName)) {
      fontFamily = "Libre Baskerville";

    // If not, check against a list of known sans/serif fonts.
    // This list is almost certainly incomplete, so should be added to when new fonts are encountered. 
    } else if (serifFontsRegex.test(fontName)) {
      fontFamily = "Libre Baskerville";
    } else if (sansFontsRegex.test(fontName)) {
      fontFamily = "Open Sans";
    } else if (fontName != "Default Metrics Font") {
      console.log("Unidentified font in XML: " + fontName);
    }
  }

  return fontFamily;

}


// Input array contents:
// [0] HOCR data
// [1] Page number
// [2] Abbyy mode
// [3] Object with arbitrary values to pass through to result
addEventListener('message', e => {
  const func = e.data[0];

  const hocrStr = e.data[1][0];
  const n = e.data[1][1];
  const abbyyMode = e.data[1][2];
  const argsObj = e.data[1][3];

  let workerResult;
  if (func == "convertPageAbbyy") {
    workerResult = [convertPageAbbyy(hocrStr, n)];
  } else if (func == "convertPageStext") {
    workerResult = [convertPageStext(hocrStr, n)];
  } else {
    workerResult = [convertPage(hocrStr, argsObj["angle"], argsObj["engine"], argsObj["pageDims"])];
  }
  workerResult.push(n, argsObj, e.data[e.data.length - 1]);
  postMessage(workerResult);
});

function fontMetrics(){
  this.width = {};
  this.height = {};
  this.desc = {};
  this.advance = {};
  this.kerning = {};
  this.obs = 0;
}

// Includes all capital letters except for "J" and "Q"
const ascCharArr = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M", "N", "O", "P", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "b", "d", "h", "k", "l", "t", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const xCharArr = ["a", "c", "e", "m", "n", "o", "r", "s", "u", "v", "w", "x", "z"]

function quantile(arr, ntile) {
  if (arr.length == 0) {
    return null
  }
  const mid = Math.floor(arr.length * ntile)
  arr.sort((a, b) => a - b);

  return arr[mid];
};

const mean50 = arr => {
  if (arr.length == 0) {
    return null;
  }
  const per25 = Math.floor(arr.length / 4) - 1;
  const per75 = Math.ceil(arr.length * 3 / 4) - 1;
  const nums = [...arr].sort((a, b) => a - b);
  const numsMiddle = nums.slice(per25, per75 + 1);

  return numsMiddle.reduce((a, b) => a + b) / numsMiddle.length;
  ;
};


function convertPage(hocrString, rotateAngle = 0, engine = null, pageDims = null) {

  rotateAngle = rotateAngle || 0;

  // let widthObjPage = { "normal": {}, "small-caps": {}, "italic": {}};
  // let heightObjPage = { "normal": {}, "small-caps": {}, "italic": {}};
  // let cutObjPage = { "normal": {}, "small-caps": {}, "italic": {}};
  // let kerningObjPage = { "normal": {}, "small-caps": {}, "italic": {}};

  const fontMetricsPage = {};

  const angleRisePage = [];
  const lineLeft = [];
  const lineTop = [];

  // If page dimensions are not provided as an argument, we assume that the entire image is being recognized
  // (so the width/height of the image bounding box is the same as the width/height of the image).
  if(!pageDims) {
    let pageElement = hocrString.match(/<div class=[\"\']ocr_page[\"\'][^\>]+/i);
    if (pageElement != null) {
      pageElement = pageElement[0];
      pageDims = pageElement.match(/bbox \d+ \d+ (\d+) (\d+)/i);
      pageDims = [parseInt(pageDims[2]), parseInt(pageDims[1])];
    }  
  }

  // Test whether character-level data (class="ocrx_cinfo" in Tesseract) is present.
  const charMode = /ocrx_cinfo/.test(hocrString) ? true : false;

  // Test whether cuts are present.
  // This will be the case for users re-importing HOCR generated by the site.
  //const cutsMode = /\<span[^\>]*cuts/i.test(hocrString) ? true : false;

  // The JavaScript regex engine does not support matching start/end tags (some other engines do), so the end of words and lines are detected
  // through a hard-coded number of </span> end tags.  The only difference charMode should make on the expressions below is the number of
  // consecutive </span> tags required.
  let lineRegex;
  if (charMode) {
    //lineRegex = new RegExp(/<span class\=[\"\']ocr_line[\s\S]+?(?:\<\/span\>\s*){3}/, "ig");
    lineRegex = new RegExp(/<span class\=[\"\']ocr_line[\s\S]+?(?:\<\/span\>\s*)(?:<\/em>\s*)?(?:\<\/span\>\s*){2}/, "ig");
  } else {
    lineRegex = new RegExp(/<span class\=[\"\']ocr_line[\s\S]+?(?:\<\/span\>\s*){2}/, "ig");
  }


  const wordRegex = new RegExp(/<span class\=[\"\']ocrx_word[\s\S]+?(?:\<\/span\>\s*)(?:<\/em>\s*)?(?:\<\/span\>\s*){1}/, "ig");
  const charRegex = new RegExp(/<span class\=[\"\']ocrx_cinfo[\"\'] title=\'([^\'\"]+)[\"\']\>([^\<]*)\<\/span\>/, "ig");
  const charBboxRegex = new RegExp(/bbox(?:es)?(\s+\d+)(\s+\d+)?(\s+\d+)?(\s+\d+)?/, "g");
  const wordElementRegex = new RegExp(/<span class\=[\"\']ocrx_word[^\>]+\>/, "i");
  //const wordTitleRegex = new RegExp(/(?<=title\=[\"\'])[^\"\']+/);

  // Remove all bold/italics tags.  These complicate the syntax and are unfortunately virtually always wrong anyway (coming from Tesseract).
  hocrString = hocrString.replaceAll(/<\/?strong>/ig, "");

  // The custom built-in Tesseract build should reliably identify italics (for Legacy only)
  if (!engine || engine != "Tesseract Legacy") {
    hocrString = hocrString.replaceAll(/<\/?em>/ig, "");
  }


  // Delete namespace to simplify xpath
  hocrString = hocrString.replace(/<html[^>]*>/i, "<html>");

  // Replace various classes with "ocr_line" class for simplicity
  // At least in Tesseract, these elements are not identified accurately or consistently enough to warrent different treatment.
  hocrString = hocrString.replace(/(class=\')ocr_caption/ig, "$1ocr_line");
  hocrString = hocrString.replace(/(class=\')ocr_textfloat/ig, "$1ocr_line");
  hocrString = hocrString.replace(/(class=\')ocr_header/ig, "$1ocr_line");

  function convertLine(match) {
    let titleStrLine = match.match(/title\=[\'\"]([^\'\"]+)/)?.[1];
    if (!titleStrLine) return;

    const fontMetricsLine = {};

    let lineAscHeightArr = [];
    let lineXHeightArr = [];
    let lineAllHeightArr = [];

    const stylesLine = {};

    let linebox = [...titleStrLine.matchAll(/bbox(?:es)?(\s+\d+)(\s+\d+)?(\s+\d+)?(\s+\d+)?/g)][0].slice(1, 5).map(function (x) { return parseInt(x) })

    // The baseline can be missing in the case of vertical text (textangle present instead)
    let baseline = [...titleStrLine.matchAll(/baseline(\s+[\d\.\-]+)(\s+[\d\.\-]+)/g)][0];
    if (baseline == null) {
      return ("");
    } else {
      baseline = baseline.slice(1, 5).map(function (x) { return parseFloat(x) });
    }
    // Only calculate baselines from lines 200px+.
    // This avoids short "lines" (e.g. page numbers) that often report wild values.
    if ((linebox[2] - linebox[0]) >= 200) {
      angleRisePage.push(baseline[0]);
      lineLeft.push(linebox[0]);
      lineTop.push(linebox[1]);
    }

    // Line font size metrics as reported by Tesseract.
    // As these are frequently not correct (as Tesseract calculates them before character recognition),
    // we calculate them as well and compare and compare. 
    let lineAllHeightTess = parseFloat(titleStrLine.match(/x_size\s+([\d\.\-]+)/)[1]);
    let lineAscHeightTess = parseFloat(titleStrLine.match(/x_ascenders\s+([\d\.\-]+)/)?.[1]);
    let lineDescHeightTess = parseFloat(titleStrLine.match(/x_descenders\s+([\d\.\-]+)/)?.[1]);

    // The only known scenario where letterHeight, ascHeight, and descHeight are not all defined
    // is when Abbyy data is loaded, HOCR is exported, and then that HOCR is re-imported.
    // As this HOCR is always at the word-level, convertWord is never run, so it does not matter
    // that xHeight is left undefined.
    let lineXHeightTess;
    if (lineAllHeightTess != null && lineAscHeightTess != null && lineDescHeightTess != null) {
      lineXHeightTess = lineAllHeightTess - lineAscHeightTess - lineDescHeightTess;
    }

    let heightSmallCapsLine = [];

    function convertWord(match) {
      let text = "";

      let italic = /<\/em>\s*<\/span>/.test(match);

      const wordID = match.match(/id\=['"]([^'"]*)['"]/i)?.[1];

      const fontName = match.match(/^[^\>]+?x_font\s*([\w\-]+)/)?.[1];

      let fontFamily = determineSansSerif(fontName);

      //let it = match.matchAll(/<span class\=[\"\']ocrx_cinfo[\"\'] title=\'([^\'\"]+)[\"\']\>([^\<]*)\<\/span\>/ig);
      let it = match.matchAll(charRegex);
      let letterArr = [...it];
      // let bboxes = Array(letterArr.length);
      let cuts = Array(letterArr.length);

      // Unlike Abbyy, which generally identifies small caps as lowercase letters (and identifies small cap text explicitly as a formatting property),
      // Tesseract (at least the Legacy model) reports them as upper-case letters.
      let wordStr = letterArr.map(x => x[2]).join("");
      let smallCaps = false;
      let smallCapsTitle = false;
      let minLetterIndex = 0;
      if (!/[a-z]/.test(wordStr) && /[A-Z].?[A-Z]/.test(wordStr)) {
        // Filter to only include letters
        const filterArr = wordStr.split("").map((x) => /[a-z]/i.test(x));
        const letterArrSub = letterArr.filter((x, y) => filterArr[y]);

        // Index of first letter (the only capital letter for title case)
        minLetterIndex = Math.min(...[...Array(filterArr.length).keys()].filter((x, y) => filterArr[y]));

        let wordBboxesTop = letterArrSub.map(x => parseInt(x[1].match(/\d+ (\d+)/)[1]));
        let wordBboxesBottom = letterArrSub.map(x => parseInt(x[1].match(/\d+ \d+ \d+ (\d+)/)[1]));

        // Check for small caps words in title case (first letter larger than all following letters)
        if (Math.min(...letterArrSub.map(x => x[1].match(/\d+ (\d+)/)[1]).map(x => Math.sign((x - wordBboxesBottom[0]) + ((wordBboxesBottom[0] - wordBboxesTop[0]) * 0.90))).slice(1)) == 1) {
          smallCaps = true;
          smallCapsTitle = true;
          for (let i = 1; i < wordBboxesTop.length; i++) {
            heightSmallCapsLine.push(wordBboxesBottom[i] - wordBboxesTop[i]);
          }
          // Check for small caps words in lowercase (all letters the same size, which is around the same size as small caps in previous words in line)
          // The 10% margin accounts for random variation in general, however is also important since rounded letters (e.g. "O") are taller but
          // less common, so will almost always exceed the median. 
        } else {
          const letterHeightArr = wordBboxesBottom.map((x, y) => x - wordBboxesTop[y]);
          const heightSmallCapsLineMedian = quantile(heightSmallCapsLine, 0.5);
          if (heightSmallCapsLineMedian && letterHeightArr.filter((x) => x > heightSmallCapsLineMedian * 1.1).length == 0) {
            smallCaps = true;
          }
        }
      }

      const bboxes = letterArr.map(x => x[1].match(/(\d+) (\d+) (\d+) (\d+)/).slice(1, 5).map((y) => parseInt(y)));

      // Adjust box such that top/bottom approximate those coordinates at the leftmost point
      const lineboxAdj = linebox.slice();

      if (baseline[0] < 0) {
        lineboxAdj[1] = lineboxAdj[1] - (lineboxAdj[2] - lineboxAdj[0]) * baseline[0];
      } else {
        lineboxAdj[3] = lineboxAdj[3] - (lineboxAdj[2] - lineboxAdj[0]) * baseline[0];
      }

      // Tesseract does not split superscript footnote references into separate words, so that happens here
      let letterArrSuper = [];
      //if (/^\W?[a-z]/i.test(wordStr) && /\d$/i.test(wordStr)) {
      if (/\d$/i.test(wordStr)) {
        const numsN = wordStr.match(/\d+$/)[0].length;

        const expectedBaseline = (bboxes[0][0] + (bboxes[bboxes.length - 1][2] - bboxes[0][0]) / 2 - lineboxAdj[0]) * baseline[0] + baseline[1] + lineboxAdj[3];
        const lineAscHeight = expectedBaseline - lineboxAdj[1];

        let baseN = 0;
        for (let i = bboxes.length - 1; i >= 0; i--) {
          if (bboxes[i][3] < expectedBaseline - lineAscHeight / 4) {
            baseN++;
          } else {
            break;
          }
        }

        const superN = Math.min(numsN, baseN);

        if (superN > 0) {
          letterArrSuper = letterArr.slice(letterArr.length - superN, letterArr.length);
          letterArr = letterArr.slice(0, letterArr.length - superN);
        }

      }

      for (let j = 0; j < letterArr.length; j++) {
        // let titleStrLetter = letterArr[j][1];
        let contentStrLetter = letterArr[j][2];
        // bboxes[j] = [...titleStrLetter.matchAll(charBboxRegex)][0].slice(1, 5).map(function (x) { return parseInt(x) });

        // Calculate metrics for character
        const charWidth = bboxes[j][2] - bboxes[j][0];
        const charHeight = bboxes[j][3] - bboxes[j][1];
        const expectedBaseline = (bboxes[j][0] - lineboxAdj[0]) * baseline[0] + baseline[1] + lineboxAdj[3];
        const charDesc = expectedBaseline - bboxes[j][3]; // Number of pixels below the baseline

        // If word is small caps, convert letters to lower case. 
        if (smallCaps && (!smallCapsTitle || j > minLetterIndex)) {
          contentStrLetter = contentStrLetter.toLowerCase();
        } 

        // Tesseract often misidentifies hyphens as other types of dashes. 
        if (contentStrLetter == "—" && charWidth < lineXHeightTess || contentStrLetter == "–" && charWidth < (lineXHeightTess * 0.85)) {
          // If the width of an en or em dash is shorter than it should be if correctly identified, and it is between two letters, it is replaced with a hyphen.
          if (j > 0 && j + 1 < letterArr.length && /[A-Za-z]/.test(letterArr[j - 1][2]) && /[A-Za-z]/.test(letterArr[j + 1][2])) {
            contentStrLetter = "-";

            // The intent of this condition is to flag hyphens that are the last character on a line.
            // However, as that info does not currently exist in this scope, we just check that the dash is the final character in the word at present. 
          } else if (j + 1 == letterArr.length) {
            contentStrLetter = "-";

          // For em dashes between two numbers, replace with en dash or hyphen depending on width of character
          } else if (contentStrLetter == "—" && j > 0 && j + 1 < letterArr.length && /\d/.test(letterArr[j - 1][2]) && /\d/.test(letterArr[j + 1][2])) {
            if (charWidth > (lineXHeightTess * 0.8)) {
              contentStrLetter = "–";
            } else {
              contentStrLetter = "-";
            }
          }

        // Correct quotes
        } else if(["“", "”", "‘", "’", "&#34;", "&#39;"].includes(contentStrLetter)) {

          // Quotes at the beginning of a word are assumed to be opening quotes
          if (["’", "”"].includes(contentStrLetter) && j == 0 && j + 1 < letterArr.length && /[a-z\d]/i.test(letterArr[j+1][2]) ) {
            if(contentStrLetter == "’") {
              contentStrLetter = "‘";
            } else if (contentStrLetter == "”") {
              contentStrLetter = "“";
            }
  
          // Single quotes between two letters are assumed to be close quotes 
          } else if (["‘", "&#39;"].includes(contentStrLetter) && j > 0 && j + 1 < letterArr.length && /[a-z\d]/i.test(letterArr[j+1][2]) && /[a-z\d]/i.test(letterArr[j-1][2]) ) {
            if(contentStrLetter == "‘") {
              contentStrLetter = "’";
            } else if (contentStrLetter == "&#39;") {
              contentStrLetter = "’";
            }

          // Quotes at the end of a word are assumed to be closing quotes
          } else if (["“", "‘"].includes(contentStrLetter) && j > 0 && j + 1 == letterArr.length && /[a-z\d,]/i.test(letterArr[j-1][2]) ) {
            if(contentStrLetter == "‘") {
              contentStrLetter = "’";
            } else if (contentStrLetter == "“") {
              contentStrLetter = "”";
            }
          }
        } 
          
        // TODO: Make this impact word bounding box calculation
        // NOTE: This issue appears to be caused by superscripts when the page is at an angle--auto-rotate may resolve before this step. 
        if (bboxes[j][1] > expectedBaseline && /[A-Za-z\d]/.test(contentStrLetter)) {
          continue;
        }

        // Multiple characters within a single <ocrx_cinfo> tag have been observed from Tesseract (even when set to char-level output).
        // May cause future issues as this code assumes one character per <ocrx_cinfo> tag.
        let charUnicode = String(contentStrLetter.charCodeAt(0));

        let style;
        if (italic) {
          style = "italic"
          stylesLine["italic"] = true;
        } else if (smallCaps) {
          style = "small-caps";
          stylesLine["small-caps"] = true;
        } else {
          style = "normal";
          stylesLine["normal"] = true;
        }

        // const fontFamily = "Default";
        if(!fontMetricsLine[fontFamily]){
          fontMetricsLine[fontFamily] = {};
        }
        for(const [style, value] of Object.entries(stylesLine)){
          if(!fontMetricsLine[fontFamily][style]){
            fontMetricsLine[fontFamily][style] = new fontMetrics();
          }
        }
    
        // Add character metrics to appropriate array(s) for later font optimization.
        // Skip letters likely misidentified due to hallucination effect (where e.g. "v" is misidentified as "V") or small caps
        const minCapsHeight = smallCaps ? 1.1 : 1.2; // Minimum believable caps height (as ratio to x-height)
        if (!(/[A-Z]/.test(contentStrLetter) && (charHeight / lineXHeightTess) < minCapsHeight)) {
          if (!fontMetricsLine[fontFamily][style]["width"][charUnicode]) {
            fontMetricsLine[fontFamily][style]["width"][charUnicode] = [];
            fontMetricsLine[fontFamily][style]["height"][charUnicode] = [];
            fontMetricsLine[fontFamily][style]["desc"][charUnicode] = [];
          }
  
          fontMetricsLine[fontFamily][style]["width"][charUnicode].push(charWidth);
          fontMetricsLine[fontFamily][style]["height"][charUnicode].push(charHeight);
          fontMetricsLine[fontFamily][style]["desc"][charUnicode].push((bboxes[j][3] - expectedBaseline));
          fontMetricsLine[fontFamily][style]["obs"] = fontMetricsLine[fontFamily][style]["obs"] + 1;

          // Save character heights to array for font size calculations
          lineAllHeightArr.push(charHeight);
          if (ascCharArr.includes(contentStrLetter)) {
            lineAscHeightArr.push(charHeight);
          } else if (xCharArr.includes(contentStrLetter)) {
            lineXHeightArr.push(charHeight);
          }

          if (j == 0) {
            cuts[j] = 0;
          } else {
            cuts[j] = bboxes[j][0] - bboxes[j - 1][2];

            const bigramUnicode = letterArr[j - 1][2].charCodeAt(0) + "," + letterArr[j][2].charCodeAt(0);
            const cuts_ex = cuts[j];

            // Only record space between characters when text is moving forward
            // This *should* always be true, however there are some fringe cases where this assumption does not hold,
            // such as Tesseract identifying the same character twice. 
            if (cuts[j] + charWidth > 0) {
              if (!fontMetricsLine[fontFamily][style]["advance"][charUnicode]) {
                fontMetricsLine[fontFamily][style]["advance"][charUnicode] = [];
              }
              fontMetricsLine[fontFamily][style]["advance"][charUnicode].push(cuts_ex);
  
              if (!fontMetricsLine[fontFamily][style]["kerning"][bigramUnicode]) {
                fontMetricsLine[fontFamily][style]["kerning"][bigramUnicode] = [];
              }
              fontMetricsLine[fontFamily][style]["kerning"][bigramUnicode].push(cuts_ex);
  
            }
          }
        }
        if (contentStrLetter.length > 1) console.log(contentStrLetter);
        text = text + contentStrLetter;
      }
      text = text ?? "";
      text = text.trim()

      let wordXML = match.match(wordElementRegex)[0];

      if (letterArrSuper.length > 0) {
        // Calculate new bounding boxes

        let wordXMLCore = "";
        if (text) {
          const bboxesCore = letterArr.map(x => x[1].match(/(\d+) (\d+) (\d+) (\d+)/).slice(1, 5));
          let wordBoxCore = new Array(4);
          wordBoxCore[0] = Math.min(...bboxesCore.map(x => x[0]));
          wordBoxCore[1] = Math.min(...bboxesCore.map(x => x[1]));
          wordBoxCore[2] = Math.max(...bboxesCore.map(x => x[2]));
          wordBoxCore[3] = Math.max(...bboxesCore.map(x => x[3]));

          const wordBoxCoreStr = wordBoxCore[0] + " " + wordBoxCore[1] + " " + wordBoxCore[2] + " " + wordBoxCore[3];

          wordXMLCore = wordXML;

          if(smallCaps || italic || fontFamily != "Default"){
            wordXMLCore = wordXMLCore.slice(0, -1) + " style='";
            if (smallCaps) {
              wordXMLCore = wordXMLCore + "font-variant:small-caps;";
            } else if (italic) {
              wordXMLCore = wordXMLCore + "font-variant:italic;";
            }
            if (fontFamily != "Default") {
              wordXMLCore = wordXMLCore + "font-family:" + fontFamily;
            }
            wordXMLCore = wordXMLCore + "'>";
          }
    
          wordXMLCore = wordXMLCore.replace(/(\d+) (\d+) (\d+) (\d+)/, wordBoxCoreStr) + text + "</span>";
        }

        const bboxesSuper = letterArrSuper.map(x => x[1].match(/(\d+) (\d+) (\d+) (\d+)/).slice(1, 5));
        let wordBoxSuper = new Array(4);
        wordBoxSuper[0] = Math.min(...bboxesSuper.map(x => x[0]));
        wordBoxSuper[1] = Math.min(...bboxesSuper.map(x => x[1]));
        wordBoxSuper[2] = Math.max(...bboxesSuper.map(x => x[2]));
        wordBoxSuper[3] = Math.max(...bboxesSuper.map(x => x[3]));

        const wordBoxSuperStr = wordBoxSuper[0] + " " + wordBoxSuper[1] + " " + wordBoxSuper[2] + " " + wordBoxSuper[3];

        const textSuper = letterArrSuper.map((x) => x[2]).join('');

        const wordXMLSuper = wordXML.replace(/(\d+) (\d+) (\d+) (\d+)/, wordBoxSuperStr).replace(/id\=['"]([^'"]*)['"]/i, "id=\"$1a\"") + "<sup>" + textSuper + "</sup>" + "</span>";

        return wordXMLCore + wordXMLSuper;


      } else {
        if (text == "") return ("");

        if(smallCaps || italic || fontFamily != "Default"){
          wordXML = wordXML.slice(0, -1) + " style='";
          if (smallCaps) {
            wordXML = wordXML + "font-variant:small-caps;";
          } else if (italic) {
            wordXML = wordXML + "font-variant:italic;";
          }
          if (fontFamily != "Default") {
            wordXML = wordXML + "font-family:" + fontFamily;
          }
          wordXML = wordXML + "'>";
        }

        return (wordXML + text + "</span>");
      }


    }
    if (charMode) {
      match = match.replaceAll(wordRegex, convertWord);
    }

    let lineXHeightFinal;

    if (lineXHeightTess) {
      // Note that not all of these numbers are directly comparable to the Tesseract version
      // For example, lineAscHeightCalc is the median height of an ascender,
      // while x_ascenders from Tesseract is [ascender height] - [x height]
      const lineAllHeightCalc = Math.max(...lineAllHeightArr);
      let lineAscHeightCalc = quantile(lineAscHeightArr, 0.5);
      const lineXHeightCalc = quantile(lineXHeightArr, 0.5);

      lineXHeightFinal = lineXHeightCalc && Math.abs(lineXHeightTess - lineXHeightCalc) > 2 ? lineXHeightCalc : lineXHeightTess;

      // When Tesseract font size metrics are significantly different from those calculated here, replace them.
      if(lineAscHeightCalc && lineXHeightCalc) {
        if(Math.abs(lineXHeightTess - lineXHeightCalc) > 2){
          match = match.replace(/(x_size\s+)([\d\.\-]+)/, "$1" + lineAllHeightCalc.toString());
          match = match.replace(/(x_ascenders\s+)([\d\.\-]+)/, "$1" + (lineAscHeightCalc - lineXHeightCalc).toString());
          match = match.replace(/(x_descenders\s+)([\d\.\-]+)/, "$1" + (lineAllHeightCalc - lineAscHeightCalc).toString());  
        }
      } else if (lineAscHeightCalc){
        if(Math.abs((lineXHeightTess + lineAscHeightTess) - lineAscHeightCalc) > 2){
          match = match.replace(/(x_size\s+)([\d\.\-]+)/, "$1" + lineAllHeightCalc.toString());
          match = match.replace(/(x_ascenders\s+)([\d\.\-]+)/, "");
          match = match.replace(/(x_descenders\s+)([\d\.\-]+)/, "$1" + (lineAllHeightCalc - lineAscHeightCalc).toString());  
        }
      }
    }


    // Normalize character metrics collected earlier, add to page-level object
    // This needs to happen after the corrected line x-height is calculated (as Tesseract's x-height calculation is often wrong for caps/small caps fonts)
    if (lineXHeightFinal) {
      for(const [family, obj] of Object.entries(fontMetricsLine)){
        for(const [style, obj2] of Object.entries(obj)){
          if (Object.keys(obj2["width"]).length == 0) continue;
          if(!fontMetricsPage[family]){
            fontMetricsPage[family] = {};
          }
          if(!fontMetricsPage[family][style]){
            fontMetricsPage[family][style] = new fontMetrics();
          }
        }  
      }

      function unionSingleFontMetrics(fontMetricsA, fontMetricsB, xHeight){
        // If one of the inputs is undefined, return early with the only valid object
        if(fontMetricsA && !fontMetricsB){
          return;
        } else if (!fontMetricsA && fontMetricsB){
          fontMetricsA = structuredClone(fontMetricsB);
        } 
      
        if(fontMetricsB?.obs) fontMetricsA.obs = fontMetricsA.obs + fontMetricsB.obs;
      
        for (const [prop, obj] of Object.entries(fontMetricsB)) {
          for (const [key, value] of Object.entries(obj)) {
            if(!fontMetricsA[prop][key]){
              fontMetricsA[prop][key] = [];
            }
            const valueNorm = value.map((x) => x / xHeight).filter((x) => x);
            Array.prototype.push.apply(fontMetricsA[prop][key], valueNorm);
          }  
        }
        return(fontMetricsA);
      }

      for(const [family, obj] of Object.entries(fontMetricsPage)){
        for(const [style, obj2] of Object.entries(obj)){
          unionSingleFontMetrics(fontMetricsPage?.[family]?.[style], fontMetricsLine?.[family]?.[style], lineXHeightFinal);
        }  
      }
    }  

    return (match);
  }


  hocrString = hocrString.replaceAll(lineRegex, convertLine);


  let angleRiseMedian = mean50(angleRisePage) || 0;


  let lineLeftAdj = new Array;
  for (let i = 0; i < lineLeft.length; i++) {
    lineLeftAdj.push(lineLeft[i] + angleRiseMedian * lineTop[i]);
  }

  let angleOut = Math.abs(rotateAngle) > 0.05 ? rotateAngle : Math.asin(angleRiseMedian) * (180 / Math.PI);
  const sinAngle = Math.sin(rotateAngle * (Math.PI / 180));
  const shiftX = sinAngle * (pageDims[0] * 0.5) * -1 || 0;

  let leftOut = quantile(lineLeft, 0.2) - shiftX;
  let leftAdjOut = quantile(lineLeftAdj, 0.2) - shiftX - leftOut;

  // With <5 lines either a left margin does not exist (e.g. a photo or title page) or cannot be reliably determined
  if (lineLeft.length < 5) {
    leftOut = null;
  }


  // Transform bounding boxes if rotation is specified.
  // This option is used when an image is rotated before it is sent to Tesseract,
  // however the HOCR needs to be applied to the original image. 
  if (Math.abs(rotateAngle) > 0.05) {

    // const sinAngle = Math.sin(rotateAngle * (Math.PI / 180));
    const cosAngle = Math.cos(rotateAngle * (Math.PI / 180));

    // const shiftX = sinAngle * (pageDims[0] * 0.5) * -1 || 0;
    const shiftY = sinAngle * ((pageDims[1] - shiftX) * 0.5) || 0;

    function rotateLine(lineStr) {

      // Add preprocessing angle to baseline angle
      const baseline = [...lineStr.matchAll(/baseline(\s+[\d\.\-]+)(\s+[\d\.\-]+)/g)][0]?.slice(1, 5)?.map(function (x) { return parseFloat(x) });
      const baselineAngleRadXML = Math.atan(baseline[0]);
      const baselineAngleRadAdj = rotateAngle * (Math.PI / 180);
      const baselineAngleRadTotal = Math.tan(baselineAngleRadXML + baselineAngleRadAdj);

      // lineStr = lineStr.replace(/baseline(\s+[\d\.\-]+)(\s+[\d\.\-]+)/, "baseline " + String(baselineAngleRadTotal) + " $2");

      const wordBoxArr = [];

      // Rotate word bounding boxes
      function rotateBoundingBox(boxStr) {

        const prefixStr = boxStr.match(/bbox(?:es)?/);
  
        let box = [...boxStr.matchAll(charBboxRegex)][0].slice(1, 5).map(function (x) { return parseInt(x) });
  
        const x = box[0] - shiftX / 2;
        const y = box[3] - (box[3] - box[1]) / 3 - shiftY / 2;

     
        box[0] = box[0] - shiftX;
        box[2] = box[2] - shiftX;
        box[1] = box[1] - shiftY;
        box[3] = box[3] - shiftY;

        // const baselineY = box[3] - (box[3] - box[1]) / 3;


        const angleAdjYInt = (1 - cosAngle) * y - sinAngle * box[0];
        // const angleAdjXInt = sinAngle * (baselineY - angleAdjYInt * 0.5);


        const xRot = x * cosAngle - sinAngle * y;
        const yRot = x * sinAngle + cosAngle * y;
  
        const angleAdjXInt = x - xRot;
  

        // const angleAdjXInt = (1-cosAngle) * box[0] + sinAngle * (baselineY - angleAdjYInt)
  
        //const angleAdjXInt = sinAngle * (box[3] - (box[3] - box[1]) / 3);
        //const angleAdjYInt = sinAngle * (box[0] + angleAdjXInt / 2) * -1;
  
        box[0] = box[0] - angleAdjXInt;
        box[2] = box[2] - angleAdjXInt;
        box[1] = box[1] - angleAdjYInt;
        box[3] = box[3] - angleAdjYInt;
  
        box = box.map((x) => Math.round(x));

        wordBoxArr.push(box);
  
        return prefixStr + " " + box[0] + " " + box[1] + " " + box[2] + " " + box[3];
  
      }

      lineStr = lineStr.replaceAll(charBboxRegex, rotateBoundingBox);

      // Recalculate line bounding box
      let lineBoxNew = new Array(4);
      lineBoxNew[0] = Math.min(...wordBoxArr.map(x => x[0]));
      lineBoxNew[1] = Math.min(...wordBoxArr.map(x => x[1]));
      lineBoxNew[2] = Math.max(...wordBoxArr.map(x => x[2]));
      lineBoxNew[3] = Math.max(...wordBoxArr.map(x => x[3]));

      const titleStrLine = lineStr.match(/title\=[\'\"]([^\'\"]+)/)?.[1];
      const linebox = [...titleStrLine.matchAll(/bbox(?:es)?(\s+[\d\-]+)(\s+[\d\-]+)?(\s+[\d\-]+)?(\s+[\d\-]+)?/g)][0].slice(1, 5).map(function (x) { return parseInt(x) });

      // const baselineOffsetAdj = baselineAngleRadAdj <= 0 ? 0 : baselineAngleRadAdj * (linebox[2] - linebox[0]);
      const baselineOffsetAdj = baselineAngleRadAdj <= 0 ? 0 : linebox[3] - lineBoxNew[3];
      const baselineOffsetTotal = baseline[1] + baselineOffsetAdj;

      lineStr = lineStr.replace(/baseline(\s+[\d\.\-]+)(\s+[\d\.\-]+)/, "baseline " + String(baselineAngleRadTotal) + " " + String(baselineOffsetTotal));


      const lineBoxStr = lineBoxNew[0] + " " + lineBoxNew[1] + " " + lineBoxNew[2] + " " + lineBoxNew[3];

      lineStr = lineStr.replace(/(\d+) (\d+) (\d+) (\d+)/, lineBoxStr);

      

      return lineStr;

    }

    hocrString = hocrString.replaceAll(/<span class\=[\"\']ocr_line[\s\S]+?(?:\<\/span\>\s*){2}/g, rotateLine);

  }

  const xmlOut = hocrString;
  const dimsOut = pageDims;

  fontMetricsPage["message"] = charMode ? "" : "char_warning";

  return ([xmlOut, dimsOut, angleOut, leftOut, leftAdjOut, fontMetricsPage, {}]);

}

const abbyyDropCapRegex = new RegExp(/\<par dropCapCharsCount\=[\'\"](\d*)/, "i");
const abbyyLineBoxRegex = new RegExp(/\<line baseline\=[\'\"](\d*)[\'\"] l\=[\'\"](\d*)[\'\"] t\=[\'\"](\d*)[\'\"] r\=[\'\"](\d*)[\'\"] b\=[\'\"](\d*)[\'\"]\>/, "i");
const abbyySplitRegex = new RegExp(/(?:\<charParams[^\>]*\>\s*\<\/charParams\>)|(?:\<\/formatting\>\s*(?=\<formatting))/, "ig");

const abbyyCharRegex = new RegExp(/(\<formatting[^\>]+\>\s*)?\<charParams l\=[\'\"](\d*)[\'\"] t\=[\'\"](\d*)[\'\"] r\=[\'\"](\d*)[\'\"] b\=[\'\"](\d*)[\'\"](?: suspicious\=[\'\"](\w*)[\'\"])?[^\>]*\>([^\<]*)\<\/charParams\>/, "ig");

function convertPageAbbyy(xmlPage, pageNum) {
  // Return early if character-level data is not detected.
  // Unlike Tesseract HOCR (which by default returns word-level data which we can still use), Abbyy XML returns line-level data that is not usable.
  let pageDims = xmlPage.match(/<page width=[\'\"](\d+)[\'\"] height=[\'\"](\d+)[\'\"]/);
  pageDims = [parseInt(pageDims[2]), parseInt(pageDims[1])];

  if (!/\<charParams/i.test(xmlPage)) {
    return (["", pageDims, null, null, null, {message: "char_error"}, {}]);
  }

  const boxes = convertTableLayoutAbbyy(xmlPage);

  const fontMetricsObj = {};

  let lineLeft = new Array;
  let lineTop = new Array;

  let lineAllHeightPageArr = [];

  let pageAscHeightArr = [];

  function convertLineAbbyy(xmlLine, lineNum, pageNum = 1) {
    let widthPxObjLine = new Object;
    let heightPxObjLine = new Object;
    let cutPxObjLine = new Object;
    let kerningPxObjLine = new Object;

    const stylesLine = {};

    // Unlike Tesseract HOCR, Abbyy XML does not provide accurate metrics for determining font size, so they are calculated here.
    // Strangely, while Abbyy XML does provide a "baseline" attribute, it is often wildly incorrect (sometimes falling outside of the bounding box entirely).
    // One guess as to why is that coordinates calculated pre-dewarping are used along with a baseline calculated post-dewarping.
    // Regardless of the reason, baseline is recalculated here.
    let lineAscHeightArr = new Array();
    let lineXHeightArr = new Array();
    let lineAllHeightArr = new Array();
    let baselineHeightArr = new Array();
    let baselineSlopeArr = new Array();
    let baselineFirst = new Array();

    const xmlLinePreChar = xmlLine.match(/^[\s\S]*?(?=\<charParams)/)?.[0];
    const xmlLineFormatting = xmlLinePreChar?.match(/\<formatting[^\>]+/)?.[0];
    const fontName = xmlLineFormatting?.match(/ff\=['"]([^'"]*)/)?.[1];

    let fontFamily = determineSansSerif(fontName);

    let dropCap = false;
    let dropCapMatch = xmlLine.match(abbyyDropCapRegex);
    if (dropCapMatch != null && parseInt(dropCapMatch[1]) > 0) {
      dropCap = true;
    }

    let lineBoxArr = xmlLine.match(abbyyLineBoxRegex);
    if (lineBoxArr == null) { return ("") };
    lineBoxArr = [...lineBoxArr].map(function (x) { return parseInt(x) });
    // Only calculate baselines from lines 200px+.
    // This avoids short "lines" (e.g. page numbers) that often report wild values.
    if ((lineBoxArr[4] - lineBoxArr[2]) >= 200) {
      //angleRisePage.push(baseline[0]);
      lineLeft.push(lineBoxArr[2]);
      lineTop.push(lineBoxArr[3]);
    }


    // Unlike Tesseract, Abbyy XML does not have a native "word" unit (it provides only lines and letters).
    // Therefore, lines are split into words on either (1) a space character or (2) a change in formatting.

    // TODO: Investigate possible fix for too many words issue:
    // The reason for splitting letters at every formatting change is (1) this splits up superscripts from
    // the words they are attached to and (2) to split up normal and italic parts of text (even if not separated by a space),
    // as the canvas GUI currently only supports one font style per word. 
    // Unfortunately, in some documents Abbyy has the nonsensical habbit of using formatting tags just to change font size
    // on a specific character (e.g. switching from font size 10.5 to 11 for a single period).
    // When this happens, the heuristic here results in too many words being created--not sure if there's an easy fix. 
    
    // Replace character identified as tab with space (so it is split into separate word)
    // For whatever reason many non-tab values can be found in elements where isTab is true (e.g. "_", "....")
    xmlLine = xmlLine.replaceAll(/isTab\=['"](?:1|true)['"]\s*\>[^\<]+/ig, "> ")

    // These regex remove blank characters that occur next to changes in formatting to avoid making too many words.
    // Note: Abbyy is inconsistent regarding where formatting elements are placed.
    // Sometimes the <format> comes after the space between words, and sometimes it comes before the space between words.
    xmlLine = xmlLine.replaceAll(/(\<\/formatting\>\<formatting[^\>]*\>\s*)<charParams[^\>]*\>\s*\<\/charParams\>/ig, "$1")
    xmlLine = xmlLine.replaceAll(/\<charParams[^\>]*\>\s*\<\/charParams\>(\s*\<\/formatting\>\<formatting[^\>]*\>\s*)/ig, "$1")

    // xmlLine = xmlLine.replaceAll(/(\<\/formatting\>\<formatting[^\>]*\>)(\s*<charParams[^\>]*\>\.\<\/charParams\>)\<\/formatting\>/ig, "$1")



    let wordStrArr1 = xmlLine.split(abbyySplitRegex);


    // Account for special cases:
    // 1. Filter off any array elements that do not have a character.
    //    (This can happen ocassionally, for example when multiple spaces are next to eachother.)
    //    TODO: This will drop formatting information in edge cases--e.g. if a formatting element is followed by multiple spaces.
    //    However, hopefully these are uncommon enough that they should not be a big issue.
    // 2. Period with its own "word" due to being wrapped in separate <formatting> tags
    //    This odd behavior appears around to superscripts, and makes sense when normal text is followed by a superscript followed by a period. 
    //    However, it also happens when normal text is followed by a period followed by a superscript (the normal behavior),
    //    and it does not make sense for a period to get its own word in this case. 

    let wordStrArr = [];
    for(let i=0;i<wordStrArr1.length;i++){
      const wordStrArrI = wordStrArr1[i];
      //const wordMatch = wordStrArrI.match(/[^\<\>]+?(?=<\/charParams\>)/g);
      const wordMatch = wordStrArrI.match(/>([^\<\>]+?)(?=<\/charParams\>)/g)?.map((x) => x.substring(1));
      if(!wordMatch){
        continue;
      } else if (wordMatch.length == 1){
        if(wordMatch[0] == ".") {
          if(wordStrArr.length > 0 && !/superscript\=[\'\"](1|true)/i.test(wordStrArr[wordStrArr.length-1])){
            wordStrArr[wordStrArr.length-1] = wordStrArr[wordStrArr.length-1] + wordStrArrI.replace(/(\<formatting[^\>]+\>\s*)/i, "");
            continue;
          }
        }
      } 
      wordStrArr.push(wordStrArrI);

    }

    if (wordStrArr.length == 0) return (["", 0]);


    let bboxes = Array(wordStrArr.length);
    let cuts = Array(wordStrArr.length);
    let text = Array(wordStrArr.length);
    text = text.fill("");
    let styleArr = Array(wordStrArr.length);
    styleArr = styleArr.fill("normal");
    let wordSusp = Array(wordStrArr.length);
    wordSusp.fill(false);


    for (let i = 0; i < wordStrArr.length; i++) {
      let wordStr = wordStrArr[i];
      let letterArr = [...wordStr.matchAll(abbyyCharRegex)];

      if (typeof (letterArr[0][1]) != "undefined") {
        if (dropCap && i == 0) {
          styleArr[i] = "dropcap";
        } else if (/superscript\=[\'\"](1|true)/i.test(letterArr[0][1])) {
          styleArr[i] = "sup";
        } else if (/italic\=[\'\"](1|true)/i.test(letterArr[0][1])) {
          styleArr[i] = "italic";
          stylesLine["italic"] = true;
        } else if (/smallcaps\=[\'\"](1|true)/i.test(letterArr[0][1])) {
          styleArr[i] = "small-caps";
          stylesLine["small-caps"] = true;
        } else {
          styleArr[i] = "normal";
          stylesLine["normal"] = true;
        }
      } else {
        if (i > 0) {
          if (styleArr[i - 1] == "dropcap") {
            styleArr[i] = "normal";
          } else {
            styleArr[i] = styleArr[i - 1];
          }
        }
      }

      // Abbyy will sometimes misidentify capital letters immediately following drop caps as small caps,
      // when they are only small in relation to the drop cap (rather than the main text).
      let dropCapFix = false;
      if (dropCap && i == 1 && styleArr[i] == "small-caps") {
        styleArr[i] = "normal";
        dropCapFix = true;
      }


      bboxes[i] = new Array();
      cuts[i] = new Array();

      for (let j = 0; j < letterArr.length; j++) {
        // Skip letters placed at coordinate 0 (not sure why this happens)
        if (letterArr[j][2] == "0") { continue };
        bboxes[i][j] = new Array();
        bboxes[i][j].push(parseInt(letterArr[j][2]));
        bboxes[i][j].push(parseInt(letterArr[j][3]));
        bboxes[i][j].push(parseInt(letterArr[j][4]));
        bboxes[i][j].push(parseInt(letterArr[j][5]));

        let letterSusp = false;
        if (letterArr[j][6] == "1" || letterArr[j][6] == "true") {
          letterSusp = true;
          wordSusp[i] = true;
        }

        if (dropCapFix) {
          letterArr[j][7] = letterArr[j][7].toUpperCase();
        }

        // In some documents Abbyy consistently uses "¬" rather than "-" for hyphenated words at the the end of lines
        if (letterArr[j][7] == "¬" && i+1 == wordStrArr1.length && j+1 == letterArr.length && i > 2) {
          letterArr[j][7] = "-";
        } else if (["’","&apos;"].includes(letterArr[j][7]) && j == 0 && letterArr.length > 2 && /^[a-z]$/i.test(letterArr[j+1][7])) {
          letterArr[j][7] = "‘";
        } else if (["”","&quot;"].includes(letterArr[j][7]) && j == 0 && letterArr.length > 2 && /^[a-z]$/i.test(letterArr[j+1][7])) {
          letterArr[j][7] = "“";
        } else if (["‘","&apos;"].includes(letterArr[j][7]) && j + 1 == letterArr.length && letterArr.length > 2 && (/^[a-z]$/i.test(letterArr[j-1][7]) || letterArr[j-1][7] == "," && /^[a-z]$/i.test(letterArr[j-2][7]))) {
          letterArr[j][7] = "’";
        } else if (["“","&quot;"].includes(letterArr[j][7]) && j + 1 == letterArr.length && letterArr.length > 2 && (/^[a-z]$/i.test(letterArr[j-1][7]) || letterArr[j-1][7] == "," && /^[a-z]$/i.test(letterArr[j-2][7]))) {
          letterArr[j][7] = "”";
        }

        let contentStrLetter = letterArr[j][7];
        text[i] = text[i] + contentStrLetter;

        lineAllHeightArr.push(bboxes[i][j][3] - bboxes[i][j][1]);

        const ascChar = ascCharArr.includes(contentStrLetter);
        const xChar = xCharArr.includes(contentStrLetter);

        // Record height for different types of characters (used for calculating font size)
        // Only full sized characters are included (no superscripts)
        if (styleArr[i] != "sup") {
          if (ascChar) {
            lineAscHeightArr.push(bboxes[i][j][3] - bboxes[i][j][1]);
          } else if (xChar) {
            lineXHeightArr.push(bboxes[i][j][3] - bboxes[i][j][1]);
          }
        }

        if ((ascChar || xChar) && !letterSusp && !dropCapFix && !(dropCap && i == 0)) {
          //baselineHeightArr.push(bboxes[i][j][3]);
          // To calculate the slope of the baseline (and therefore image angle) the position of each glyph that starts (approximately) on the
          // baseline is compared to the first such glyph.  This is less precise than a true "best fit" approach, but hopefully with enough data
          // points it will all average out.
          if (baselineFirst.length == 0) {
            baselineFirst.push(bboxes[i][j][0], bboxes[i][j][3]);
          } else {

            baselineSlopeArr.push((bboxes[i][j][3] - baselineFirst[1]) / (bboxes[i][j][0] - baselineFirst[0]));

          }
        }

        // Add character metrics to appropriate arrays (for font optimization)
        // This step is skipped for superscripts + drop caps
        if(["sup","dropcap"].includes(styleArr[i])) continue;

        const charUnicode = String(contentStrLetter.charCodeAt(0));
        const charWidth = bboxes[i][j][2] - bboxes[i][j][0];
        const charHeight = bboxes[i][j][3] - bboxes[i][j][1];

        if (!widthPxObjLine[styleArr[i]]) {
          widthPxObjLine[styleArr[i]] = new Array();
          heightPxObjLine[styleArr[i]] = new Array();
        }

        if (widthPxObjLine[styleArr[i]][charUnicode] == null) {
          widthPxObjLine[styleArr[i]][charUnicode] = new Array();
          heightPxObjLine[styleArr[i]][charUnicode] = new Array();
        }
        widthPxObjLine[styleArr[i]][charUnicode].push(charWidth);
        heightPxObjLine[styleArr[i]][charUnicode].push(charHeight);

        if (j == 0) {
          cuts[i][j] = 0;

        // This condition avoids errors caused by skipping letters (e.g. when the x coordinate is "0")
        } else if(bboxes[i][j]?.[0] && bboxes[i][j - 1]?.[2]){
          cuts[i][j] = bboxes[i][j][0] - bboxes[i][j - 1][2];

          const bigramUnicode = letterArr[j - 1][7].charCodeAt(0) + "," + letterArr[j][7].charCodeAt(0);
          // Quick fix so it runs--need to figure out how to calculate x-height from Abbyy XML
          const cuts_ex = cuts[i][j];

          if (!cutPxObjLine[styleArr[i]]) {
            cutPxObjLine[styleArr[i]] = new Array();
          }

          if (cutPxObjLine[styleArr[i]][charUnicode] == null) {
            cutPxObjLine[styleArr[i]][charUnicode] = new Array();
          }
          cutPxObjLine[styleArr[i]][charUnicode].push(cuts_ex);

          if (!kerningPxObjLine[styleArr[i]]) {
            kerningPxObjLine[styleArr[i]] = new Array();
          }

          if (kerningPxObjLine[styleArr[i]][bigramUnicode] == null) {
            kerningPxObjLine[styleArr[i]][bigramUnicode] = new Array();
          }
          kerningPxObjLine[styleArr[i]][bigramUnicode].push(cuts_ex);
        }
      }
    }

    let lineAllHeight = Math.max(...lineAllHeightArr);
    let lineAscHeight = quantile(lineAscHeightArr, 0.75);
    const lineXHeight = quantile(lineXHeightArr, 0.5);

    // The above calculations fail for lines without any alphanumeric characters (e.g. a line that only contains a dash),
    // as this will cause the value of `lineAllHeight` to be very low, and the font size will be extremely small. 
    // While this may seem like a fringe case, it frequently happens for tables as Abbyy make a new "<line>" element for 
    // each individual cell. 
    // Additionally, sometimes all letters may be skipped (for the purposes of calculating statistics), in which case
    // the lineAllHeight will be -Infinity.
    // Therefore, as a quick fix, whenever the lineAllHeight value is small/dubious it is replaced by the median for the page (so far),
    // and 10 when the median cannot be calculated. 
    // TODO: Refine this logic to reduce or eliminate the case where lineAllHeight = 10
    if(lineAllHeight < 10 && !lineAscHeight && !lineXHeight) {
      if (lineAllHeightPageArr.length > 0) {
        const lineAllHeightMedian = quantile(lineAllHeightPageArr, 0.5);
        if(lineAllHeightMedian > lineAllHeight) {
          lineAllHeight = lineAllHeightMedian;
        }  
      } else {
        lineAllHeight = 10;
      }
    } else {
      lineAllHeightPageArr.push(lineAllHeight);
    }


    if(!fontMetricsObj[fontFamily]){
      fontMetricsObj[fontFamily] = {};
    }
    for(const [style, value] of Object.entries(stylesLine)){
      if(!fontMetricsObj[fontFamily][style]){
        fontMetricsObj[fontFamily][style] = new fontMetrics();
      }
    }

    if (lineXHeight != null) {
      for (const [style, obj] of Object.entries(widthPxObjLine)) {
        for (const [key, value] of Object.entries(obj)) {
          if (parseInt(key) < 33) { continue };

          if (fontMetricsObj[fontFamily][style]["width"][key] == null) {
            fontMetricsObj[fontFamily][style]["width"][key] = new Array();
          }
          for (let k = 0; k < value.length; k++) {
            fontMetricsObj[fontFamily][style]["width"][key].push(value[k] / lineXHeight);
            fontMetricsObj[fontFamily][style]["obs"] = fontMetricsObj[fontFamily][style]["obs"] + 1;
          }
        }
      }

      for (const [style, obj] of Object.entries(heightPxObjLine)) {
        for (const [key, value] of Object.entries(obj)) {
          if (parseInt(key) < 33) { continue };

          if (fontMetricsObj[fontFamily][style]["height"][key] == null) {
            fontMetricsObj[fontFamily][style]["height"][key] = new Array();
          }
          for (let k = 0; k < value.length; k++) {
            fontMetricsObj[fontFamily][style]["height"][key].push(value[k] / lineXHeight);
          }
        }
      }


      for (const [style, obj] of Object.entries(cutPxObjLine)) {
        for (const [key, value] of Object.entries(obj)) {
          if (parseInt(key) < 33) { continue };

          if (fontMetricsObj[fontFamily][style]["advance"][key] == null) {
            fontMetricsObj[fontFamily][style]["advance"][key] = new Array();
          }
          for (let k = 0; k < value.length; k++) {
            fontMetricsObj[fontFamily][style]["advance"][key].push(value[k] / lineXHeight);
          }
        }
      }

      for (const [style, obj] of Object.entries(kerningPxObjLine)) {
        for (const [key, value] of Object.entries(obj)) {
          if (parseInt(key) < 33) { continue };

          if (fontMetricsObj[fontFamily][style]["kerning"][key] == null) {
            fontMetricsObj[fontFamily][style]["kerning"][key] = new Array();
          }
          for (let k = 0; k < value.length; k++) {
            fontMetricsObj[fontFamily][style]["kerning"][key].push(value[k] / lineXHeight);
          }
        }
      }

    }

    // While Abbyy XML already provides line bounding boxes, these have been observed to be (at times)
    // completely different than a bounding box calculated from a union of all letters in the line.
    // Therefore, the line bounding boxes are recaclculated here.
    let lineBoxArrCalc = new Array(4);
    // reduce((acc, val) => acc.concat(val), []) is used as a drop-in replacement for flat() with significantly better performance
    lineBoxArrCalc[0] = Math.min(...bboxes.reduce((acc, val) => acc.concat(val), []).map(x => x[0]).filter(x => x > 0));
    lineBoxArrCalc[1] = Math.min(...bboxes.reduce((acc, val) => acc.concat(val), []).map(x => x[1]).filter(x => x > 0));
    lineBoxArrCalc[2] = Math.max(...bboxes.reduce((acc, val) => acc.concat(val), []).map(x => x[2]).filter(x => x > 0));
    lineBoxArrCalc[3] = Math.max(...bboxes.reduce((acc, val) => acc.concat(val), []).map(x => x[3]).filter(x => x > 0));

    const baselineSlope = quantile(baselineSlopeArr, 0.5) || 0;

    // baselinePoint should be the offset between the bottom of the line bounding box, and the baseline at the leftmost point
    let baselinePoint = baselineFirst[1] - lineBoxArrCalc[3];
    if(baselineSlope < 0) {
      baselinePoint = baselinePoint - baselineSlope * (baselineFirst[0] - lineBoxArrCalc[0]);
    }
    baselinePoint = baselinePoint || 0;


    // const baselinePoint = baselineFirst[1] - lineBoxArrCalc[3] - baselineSlope * (baselineFirst[0] - lineBoxArrCalc[0]) || 0;

    let xmlOut = "";

    // In a small number of cases the bounding box cannot be calculated because all individual character-level bounding boxes are at 0 (and therefore skipped)
    // In this case the original line-level bounding box from Abbyy is used
    if (isFinite(lineBoxArrCalc[0]) && isFinite(lineBoxArrCalc[1]) && isFinite(lineBoxArrCalc[2]) && isFinite(lineBoxArrCalc[3])) {
      xmlOut += "<span class='ocr_line' title=\"bbox " + lineBoxArrCalc[0] + " " + lineBoxArrCalc[1] + " " + lineBoxArrCalc[2] + " " + lineBoxArrCalc[3];
    } else {
      xmlOut += "<span class='ocr_line' title=\"bbox " + lineBoxArr[2] + " " + lineBoxArr[3] + " " + lineBoxArr[4] + " " + lineBoxArr[5];
    }

    xmlOut = xmlOut + "; baseline " + round6(baselineSlope) + " " + Math.round(baselinePoint);

    // Calculate character size metrics (x_size, x_ascenders, x_descenders)
    // Ideally we would be able to calculate all 3 directly, however given this is not always possible,
    // different calculations are used based on the data available.

    // If no ascenders exist on the line but x-height is known, set ascender height using the median ascender height / x-height ratio for the page so far,
    // and 1.5x the x-height as a last resort. 
    if (lineXHeight && !(lineAscHeight && (styleArr.includes("small-caps") || (lineAscHeight > lineXHeight * 1.1) && (lineAscHeight < lineXHeight * 2)))) {
      if(pageAscHeightArr.length >= 3) {
        lineAscHeight = lineXHeight * quantile(pageAscHeightArr, 0.5);
      } else {
        lineAscHeight = Math.round(lineXHeight * 1.5);
      }
    } else if(lineXHeight) {
      pageAscHeightArr.push(lineAscHeight / lineXHeight);
    }

    // Add character height (misleadingly called "x_size" in Tesseract hocr)
    xmlOut = xmlOut + "; x_size " + lineAllHeight;
    // If x-height exists, calculate x_ascenders (in addition to x_descenders)
    // In general, x-height must be a plausible value (to avoid obviously misidentified characters from determining font size).
    // This restriction is not applied for lines with small caps. 
    if (lineAscHeight && lineXHeight) {
      xmlOut = xmlOut + "; x_ascenders " + (lineAscHeight - lineXHeight) + "; x_descenders " + (lineAllHeight - lineAscHeight);
      // Otherwise, add only x_descenders
    } else if (lineAscHeight) {
      // console.log("Rejecting xheight: " + lineXHeight, + " " + lineAscHeight + " on page " + pageNum);
      // console.log(text);
      xmlOut = xmlOut + "; x_descenders " + (lineAllHeight - lineAscHeight);
    }



    xmlOut = xmlOut + "\">";

    let lettersKept = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i].trim() == "") { continue };
      let bboxesI = bboxes[i];

      // Abbyy-specific fix:
      // Only values > 0 are considered, since Abbyy has been observed to frequently return incorrect "0" coordinates.
      // This frequently (but not always) occurs with superscripts.
      // If this filter leaves no remaining left/right/top/bottom coordinates, the word is skipped entirely.
      // TODO: Figure out why this happens and whether these glyphs should be dropped completely.
      const bboxesILeft = Math.min(...bboxesI.map(x => x[0]).filter(x => x > 0));
      const bboxesIRight = Math.max(...bboxesI.map(x => x[2]).filter(x => x > 0));
      const bboxesITop = Math.min(...bboxesI.map(x => x[1]).filter(x => x > 0));
      const bboxesIBottom = Math.max(...bboxesI.map(x => x[3]).filter(x => x > 0));

      if (!isFinite(bboxesITop) || !isFinite(bboxesIBottom) || !isFinite(bboxesILeft) || !isFinite(bboxesIRight)) {
        continue;
      }

      xmlOut = xmlOut + "<span class='ocrx_word' id='word_" + (pageNum + 1) + "_" + (lineNum + 1) + "_" + (i + 1) + "' title='bbox " + bboxesILeft + " " + bboxesITop + " " + bboxesIRight + " " + bboxesIBottom;
      if (wordSusp[i]) {
        xmlOut = xmlOut + ";x_wconf 0";
      } else {
        xmlOut = xmlOut + ";x_wconf 100";
      }
      xmlOut = xmlOut + "\'"

      // Add "style" attribute (if applicable)
      if(["italic","small-caps"].includes(styleArr[i]) || fontFamily != "Default") {
        xmlOut = xmlOut + " style='"

        if (styleArr[i] == "italic") {
          xmlOut = xmlOut + "font-style:italic" ;
        } else if (styleArr[i] == "small-caps") {
          xmlOut = xmlOut + "font-variant:small-caps";
        } 

        if (fontFamily != "Default") {
          xmlOut = xmlOut + "font-family:" + fontFamily;
        }

        xmlOut = xmlOut + "'>"
      } else {
        xmlOut = xmlOut + ">"
      }

      // Add word text, along with any formatting that uses nested elements rather than attributes
      if (styleArr[i] == "sup") {
        xmlOut = xmlOut + "<sup>" + text[i] + "</sup>" + "</span>";
      } else if (styleArr[i] == "dropcap") {
        xmlOut = xmlOut + "<span class='ocr_dropcap'>" + text[i] + "</span>" + "</span>";
      } else {
        xmlOut = xmlOut + text[i] + "</span>";
      }

      lettersKept++;

    }

    // If there are no letters in the line, drop the entire line element
    if (lettersKept == 0) return (["", 0]);

    xmlOut = xmlOut + "</span>"
    return ([xmlOut, baselineSlope]);
  }


  let lineStrArr = xmlPage.split(/\<\/line\>/);

  let xmlOut = "<div class='ocr_page'";

  xmlOut = xmlOut + " title='bbox 0 0 " + pageDims[1] + " " + pageDims[0] + "'>";

  let angleRisePage = new Array();
  for (let i = 0; i < lineStrArr.length; i++) {
    const lineInt = convertLineAbbyy(lineStrArr[i], i, pageNum);
    if (lineInt[0] == "") continue;
    angleRisePage.push(lineInt[1]);
    xmlOut = xmlOut + lineInt[0];
  }
  xmlOut = xmlOut + "</div>";

  let angleRiseMedian = mean50(angleRisePage) || 0;

  const angleOut = Math.asin(angleRiseMedian) * (180 / Math.PI);


  let lineLeftAdj = new Array;
  for (let i = 0; i < lineLeft.length; i++) {
    lineLeftAdj.push(lineLeft[i] + angleRiseMedian * lineTop[i]);
  }
  let leftOut = quantile(lineLeft, 0.2);
  let leftAdjOut = quantile(lineLeftAdj, 0.2) - leftOut;
  // With <5 lines either a left margin does not exist (e.g. a photo or title page) or cannot be reliably determined
  if (lineLeft.length < 5) {
    leftOut = null;
  }

  const dimsOut = pageDims;

  return ([xmlOut, dimsOut, angleOut, leftOut, leftAdjOut, fontMetricsObj, boxes]);

}

const stextLineBoxRegex = new RegExp(/\<line bbox\=[\'\"]\>/, "i");
const stextSplitRegex = new RegExp(/(?:\<char[^\>]*?c=[\'\"]\s+[\'\"]\/\>)|(?:\<\/font\>\s*(?=\<font))/, "ig");
// The "quad" attribute includes 8 numbers (x and y coordinates for all 4 corners) however we only use capturing groups for 4
const stextCharRegex = new RegExp(/(\<font[^\>]+\>\s*)?\<char quad=[\'\"](\s*[\d\.\-]+)(\s*[\d\.\-]+)(?:\s*[\d\.\-]+)(?:\s*[\d\.\-]+)(?:\s*[\d\.\-]+)(?:\s*[\d\.\-]+)(\s*[\d\.\-]+)(\s*[\d\.\-]+)[^\>]*?y=[\'\"]([\d\.\-]+)[\'\"][^\>]*?c=[\'\"]([^\'\"]+)[\'\"]\s*\/\>/, "ig");


// Conversion function for "stext" (or "structured text" output from mupdf)
// This format is more similar to Abbyy XML and is based on that parsing code.
// The following features were removed (compared with Abbyy XML):
// - Drop cap detection
// - Superscript detection
function convertPageStext(xmlPage, pageNum) {

  let pageDims = xmlPage.match(/<page .+?width=[\'\"]([\d\.\-]+)[\'\"] height=[\'\"]([\d\.\-]+)[\'\"]/);
  pageDims = [parseInt(pageDims[2]), parseInt(pageDims[1])];

  const fontMetricsObj = {};

  let lineLeft = new Array;
  let lineTop = new Array;

  let lineAllHeightPageArr = [];

  let pageAscHeightArr = [];

  function convertLineStext(xmlLine, lineNum, pageNum = 1) {
    let widthPxObjLine = new Object;
    let heightPxObjLine = new Object;
    let cutPxObjLine = new Object;
    let kerningPxObjLine = new Object;

    const stylesLine = {};

    // Unlike Tesseract HOCR, Abbyy XML does not provide accurate metrics for determining font size, so they are calculated here.
    // Strangely, while Abbyy XML does provide a "baseline" attribute, it is often wildly incorrect (sometimes falling outside of the bounding box entirely).
    // One guess as to why is that coordinates calculated pre-dewarping are used along with a baseline calculated post-dewarping.
    // Regardless of the reason, baseline is recalculated here.
    let lineAscHeightArr = new Array();
    let lineXHeightArr = new Array();
    let lineAllHeightArr = new Array();
    let baselineHeightArr = new Array();
    let baselineSlopeArr = new Array();
    let baselineFirst = new Array();

    const xmlLinePreChar = xmlLine.match(/^[\s\S]*?(?=\<char)/)?.[0];
    if (!xmlLinePreChar) { return ("") };

    const xmlLineFormatting = xmlLinePreChar?.match(/\<font[^\>]+/)?.[0];
    const fontName = xmlLineFormatting?.match(/name\=['"]([^'"]*)/)?.[1];
    const fontSize = parseFloat(xmlLineFormatting?.match(/size\=['"]([^'"]*)/)?.[1]);

    let fontFamily = determineSansSerif(fontName);

    // Currently no method of detecting drop caps for stext
    let dropCap = false;
    // let dropCapMatch = xmlLine.match(abbyyDropCapRegex);
    // if (dropCapMatch != null && parseInt(dropCapMatch[1]) > 0) {
    //   dropCap = true;
    // }

    let lineBoxArr = [...xmlLinePreChar.matchAll(/bbox(?:es)?=[\'\"](\s*[\d\.\-]+)(\s*[\d\.\-]+)?(\s*[\d\.\-]+)?(\s*[\d\.\-]+)?/g)][0].slice(1, 5).map(function (x) { return Math.max(parseFloat(x),0) })

    if (lineBoxArr == null) { return ("") };
    lineBoxArr = [...lineBoxArr].map(function (x) { return parseInt(x) });
    // Only calculate baselines from lines 200px+.
    // This avoids short "lines" (e.g. page numbers) that often report wild values.
    if ((lineBoxArr[4] - lineBoxArr[2]) >= 200) {
      //angleRisePage.push(baseline[0]);
      lineLeft.push(lineBoxArr[2]);
      lineTop.push(lineBoxArr[3]);
    }

    // These regex remove blank characters that occur next to changes in formatting to avoid making too many words.
    // stext is confirmed to (at least sometimes) change formatting before a space character rather than after
    xmlLine = xmlLine.replaceAll(/(\<\/font\>\s*\<font[^\>]*\>\s*)\<char[^\>]*?c=[\'\"]\s+[\'\"]\/\>/ig, "$1");
    xmlLine = xmlLine.replaceAll(/\<char[^\>]*?c=[\'\"]\s+[\'\"]\/\>(\s*\<\/font\>\s*\<font[^\>]*\>\s*)/ig, "$1");

    // Remove spaces that are the first characters of words
    xmlLine = xmlLine.replaceAll(/(<font[^\>]*\>\s*)\<char[^\>]*?c=[\'\"]\s+[\'\"]\/\>/ig, "$1");

    // Unlike Tesseract, stext does not have a native "word" unit (it provides only lines and letters).
    // Therefore, lines are split into words on either (1) a space character or (2) a change in formatting.
    let wordStrArr = xmlLine.split(stextSplitRegex);


    if (wordStrArr.length == 0) return (["", 0]);


    let bboxes = Array(wordStrArr.length);
    let cuts = Array(wordStrArr.length);
    let text = Array(wordStrArr.length);
    text = text.fill("");
    let styleArr = Array(wordStrArr.length);
    styleArr = styleArr.fill("normal");
    let wordSusp = Array(wordStrArr.length);
    wordSusp.fill(false);


    for (let i = 0; i < wordStrArr.length; i++) {
      let wordStr = wordStrArr[i];
      let letterArr = [...wordStr.matchAll(stextCharRegex)];
      if (letterArr.length == 0) continue;
      if (typeof (letterArr[0][1]) != "undefined") {
        if (dropCap && i == 0) {
          styleArr[i] = "dropcap";
        // } else if (/superscript\=[\'\"](1|true)/i.test(letterArr[0][1])) {
        //   styleArr[i] = "sup";
        } else if (/italic/i.test(letterArr[0][1])) {
          styleArr[i] = "italic";
          stylesLine["italic"] = true;
        } else if (/small\W?cap/i.test(letterArr[0][1])) {
          styleArr[i] = "small-caps";
          stylesLine["small-caps"] = true;
        } else {
          styleArr[i] = "normal";
          stylesLine["normal"] = true;
        }
      } else {
        if (i > 0) {
          if (styleArr[i - 1] == "dropcap") {
            styleArr[i] = "normal";
          } else {
            styleArr[i] = styleArr[i - 1];
          }
        }
      }

      bboxes[i] = new Array();
      cuts[i] = new Array();

      for (let j = 0; j < letterArr.length; j++) {

        // Math.round(parseFloat(x)) is used rather than parseInt because parseInt returns NaN for numbers without a leading digit--e.g. ".1"
        bboxes[i][j] = [];
        bboxes[i][j].push(Math.round(parseFloat(letterArr[j][2])));
        bboxes[i][j].push(Math.round(parseFloat(letterArr[j][3])));
        bboxes[i][j].push(Math.round(parseFloat(letterArr[j][4])));
        bboxes[i][j].push(Math.round(parseFloat(letterArr[j][5])));
        // The 5th element is the y coordinate of the baseline, which is not in the Abbyy version
        bboxes[i][j].push(Math.round(parseFloat(letterArr[j][6])));

        // All text in stext is considered correct/high confidence
        let letterSusp = false;
        // if (letterArr[j][6] == "1" || letterArr[j][6] == "true") {
        //   letterSusp = true;
        //   wordSusp[i] = true;
        // }

        // In some documents Abbyy consistently uses "¬" rather than "-" for hyphenated words at the the end of lines
        if (letterArr[j][7] == "¬" && i+1 == wordStrArr.length && j+1 == letterArr.length && i > 2) {
          letterArr[j][7] = "-";
        } else if (["’","&apos;"].includes(letterArr[j][7]) && j == 0 && letterArr.length > 2 && /^[a-z]$/i.test(letterArr[j+1][7])) {
          letterArr[j][7] = "‘";
        } else if (["”","&quot;"].includes(letterArr[j][7]) && j == 0 && letterArr.length > 2 && /^[a-z]$/i.test(letterArr[j+1][7])) {
          letterArr[j][7] = "“";
        } else if (["‘","&apos;"].includes(letterArr[j][7]) && j + 1 == letterArr.length && letterArr.length > 2 && (/^[a-z]$/i.test(letterArr[j-1][7]) || letterArr[j-1][7] == "," && /^[a-z]$/i.test(letterArr[j-2][7]))) {
          letterArr[j][7] = "’";
        } else if (["“","&quot;"].includes(letterArr[j][7]) && j + 1 == letterArr.length && letterArr.length > 2 && (/^[a-z]$/i.test(letterArr[j-1][7]) || letterArr[j-1][7] == "," && /^[a-z]$/i.test(letterArr[j-2][7]))) {
          letterArr[j][7] = "”";
        }

        let contentStrLetter = letterArr[j][7];
        text[i] = text[i] + contentStrLetter;

        lineAllHeightArr.push(bboxes[i][j][3] - bboxes[i][j][1]);

        const ascChar = ascCharArr.includes(contentStrLetter);
        const xChar = xCharArr.includes(contentStrLetter);

        // Record height for different types of characters (used for calculating font size)
        // Only full sized characters are included (no superscripts)
        if (styleArr[i] != "sup") {
          if (ascChar) {
            lineAscHeightArr.push(bboxes[i][j][3] - bboxes[i][j][1]);
          } else if (xChar) {
            lineXHeightArr.push(bboxes[i][j][3] - bboxes[i][j][1]);
          }
        }

        // Unlike for Abbyy and Tesseract (which both have actual bounding boxes that correspond to pixels), stext uses the same bounding boxes for all characters.
        // In other words, "." and "A" will have the same bounding box if written in the same font/font size. 
        // This means we cannot use character bounding boxes to determine the height of individual characters. 

        // if ((ascChar || xChar) && !letterSusp && !(dropCap && i == 0)) {
        if (!letterSusp && !(dropCap && i == 0)) {


          // To calculate the slope of the baseline (and therefore image angle) the position of each glyph that starts (approximately) on the
          // baseline is compared to the first such glyph.  This is less precise than a true "best fit" approach, but hopefully with enough data
          // points it will all average out.
          if (baselineFirst.length == 0) {
            baselineFirst.push(bboxes[i][j][0], bboxes[i][j][4]);
          } else {

            baselineSlopeArr.push((bboxes[i][j][4] - baselineFirst[1]) / (bboxes[i][j][0] - baselineFirst[0]));

          }
        }

        // Add character metrics to appropriate arrays (for font optimization)
        // This step is skipped for superscripts + drop caps
        if(["sup","dropcap"].includes(styleArr[i])) continue;

        const charUnicode = String(contentStrLetter.charCodeAt(0));
        const charWidth = bboxes[i][j][2] - bboxes[i][j][0];
        const charHeight = bboxes[i][j][3] - bboxes[i][j][1];

        if (!widthPxObjLine[styleArr[i]]) {
          widthPxObjLine[styleArr[i]] = new Array();
          heightPxObjLine[styleArr[i]] = new Array();
        }

        if (widthPxObjLine[styleArr[i]][charUnicode] == null) {
          widthPxObjLine[styleArr[i]][charUnicode] = new Array();
          heightPxObjLine[styleArr[i]][charUnicode] = new Array();
        }
        widthPxObjLine[styleArr[i]][charUnicode].push(charWidth);
        heightPxObjLine[styleArr[i]][charUnicode].push(charHeight);

        if (j == 0) {
          cuts[i][j] = 0;

        // This condition avoids errors caused by skipping letters (e.g. when the x coordinate is "0")
        } else if(bboxes[i][j]?.[0] && bboxes[i][j - 1]?.[2]){
          cuts[i][j] = bboxes[i][j][0] - bboxes[i][j - 1][2];

          const bigramUnicode = letterArr[j - 1][7].charCodeAt(0) + "," + letterArr[j][7].charCodeAt(0);
          // Quick fix so it runs--need to figure out how to calculate x-height from Abbyy XML
          const cuts_ex = cuts[i][j];

          if (!cutPxObjLine[styleArr[i]]) {
            cutPxObjLine[styleArr[i]] = new Array();
          }

          if (cutPxObjLine[styleArr[i]][charUnicode] == null) {
            cutPxObjLine[styleArr[i]][charUnicode] = new Array();
          }
          cutPxObjLine[styleArr[i]][charUnicode].push(cuts_ex);

          if (!kerningPxObjLine[styleArr[i]]) {
            kerningPxObjLine[styleArr[i]] = new Array();
          }

          if (kerningPxObjLine[styleArr[i]][bigramUnicode] == null) {
            kerningPxObjLine[styleArr[i]][bigramUnicode] = new Array();
          }
          kerningPxObjLine[styleArr[i]][bigramUnicode].push(cuts_ex);
        }
      }
    }

    let lineAllHeight = Math.max(...lineAllHeightArr);
    let lineAscHeight = quantile(lineAscHeightArr, 0.75);
    const lineXHeight = quantile(lineXHeightArr, 0.5);

    // The above calculations fail for lines without any alphanumeric characters (e.g. a line that only contains a dash),
    // as this will cause the value of `lineAllHeight` to be very low, and the font size will be extremely small. 
    // While this may seem like a fringe case, it frequently happens for tables as Abbyy make a new "<line>" element for 
    // each individual cell. 
    // Additionally, sometimes all letters may be skipped (for the purposes of calculating statistics), in which case
    // the lineAllHeight will be -Infinity.
    // Therefore, as a quick fix, whenever the lineAllHeight value is small/dubious it is replaced by the median for the page (so far),
    // and 10 when the median cannot be calculated. 
    // TODO: Refine this logic to reduce or eliminate the case where lineAllHeight = 10
    if(lineAllHeight < 10 && !lineAscHeight && !lineXHeight) {
      if (lineAllHeightPageArr.length > 0) {
        const lineAllHeightMedian = quantile(lineAllHeightPageArr, 0.5);
        if(lineAllHeightMedian > lineAllHeight) {
          lineAllHeight = lineAllHeightMedian;
        }  
      } else {
        lineAllHeight = 10;
      }
    } else {
      lineAllHeightPageArr.push(lineAllHeight);
    }


    if(!fontMetricsObj[fontFamily]){
      fontMetricsObj[fontFamily] = {};
    }
    for(const [style, value] of Object.entries(stylesLine)){
      if(!fontMetricsObj[fontFamily][style]){
        fontMetricsObj[fontFamily][style] = new fontMetrics();
      }
    }

    if (lineXHeight != null) {
      for (const [style, obj] of Object.entries(widthPxObjLine)) {
        for (const [key, value] of Object.entries(obj)) {
          if (parseInt(key) < 33) { continue };

          if (fontMetricsObj[fontFamily][style]["width"][key] == null) {
            fontMetricsObj[fontFamily][style]["width"][key] = new Array();
          }
          for (let k = 0; k < value.length; k++) {
            fontMetricsObj[fontFamily][style]["width"][key].push(value[k] / lineXHeight);
            fontMetricsObj[fontFamily][style]["obs"] = fontMetricsObj[fontFamily][style]["obs"] + 1;
          }
        }
      }

      for (const [style, obj] of Object.entries(heightPxObjLine)) {
        for (const [key, value] of Object.entries(obj)) {
          if (parseInt(key) < 33) { continue };

          if (fontMetricsObj[fontFamily][style]["height"][key] == null) {
            fontMetricsObj[fontFamily][style]["height"][key] = new Array();
          }
          for (let k = 0; k < value.length; k++) {
            fontMetricsObj[fontFamily][style]["height"][key].push(value[k] / lineXHeight);
          }
        }
      }


      for (const [style, obj] of Object.entries(cutPxObjLine)) {
        for (const [key, value] of Object.entries(obj)) {
          if (parseInt(key) < 33) { continue };

          if (fontMetricsObj[fontFamily][style]["advance"][key] == null) {
            fontMetricsObj[fontFamily][style]["advance"][key] = new Array();
          }
          for (let k = 0; k < value.length; k++) {
            fontMetricsObj[fontFamily][style]["advance"][key].push(value[k] / lineXHeight);
          }
        }
      }

      for (const [style, obj] of Object.entries(kerningPxObjLine)) {
        for (const [key, value] of Object.entries(obj)) {
          if (parseInt(key) < 33) { continue };

          if (fontMetricsObj[fontFamily][style]["kerning"][key] == null) {
            fontMetricsObj[fontFamily][style]["kerning"][key] = new Array();
          }
          for (let k = 0; k < value.length; k++) {
            fontMetricsObj[fontFamily][style]["kerning"][key].push(value[k] / lineXHeight);
          }
        }
      }

    }

    // NOTE: This section can probably be deleted for stext as it seems specific to Abbyy
    // While Abbyy XML already provides line bounding boxes, these have been observed to be (at times)
    // completely different than a bounding box calculated from a union of all letters in the line.
    // Therefore, the line bounding boxes are recaclculated here.
    let lineBoxArrCalc = new Array(4);
    // reduce((acc, val) => acc.concat(val), []) is used as a drop-in replacement for flat() with significantly better performance
    lineBoxArrCalc[0] = Math.min(...bboxes.reduce((acc, val) => acc.concat(val), []).map(x => x[0]).filter(x => x > 0));
    lineBoxArrCalc[1] = Math.min(...bboxes.reduce((acc, val) => acc.concat(val), []).map(x => x[1]).filter(x => x > 0));
    lineBoxArrCalc[2] = Math.max(...bboxes.reduce((acc, val) => acc.concat(val), []).map(x => x[2]).filter(x => x > 0));
    lineBoxArrCalc[3] = Math.max(...bboxes.reduce((acc, val) => acc.concat(val), []).map(x => x[3]).filter(x => x > 0));

    const baselineSlope = quantile(baselineSlopeArr, 0.5) || 0;

    // baselinePoint should be the offset between the bottom of the line bounding box, and the baseline at the leftmost point
    let baselinePoint = baselineFirst[1] - lineBoxArrCalc[3];
    if(baselineSlope < 0) {
      baselinePoint = baselinePoint - baselineSlope * (baselineFirst[0] - lineBoxArrCalc[0]);
    }
    baselinePoint = baselinePoint || 0;

    let xmlOut = "";

    // In a small number of cases the bounding box cannot be calculated because all individual character-level bounding boxes are at 0 (and therefore skipped)
    // In this case the original line-level bounding box from Abbyy is used
    if (isFinite(lineBoxArrCalc[0]) && isFinite(lineBoxArrCalc[1]) && isFinite(lineBoxArrCalc[2]) && isFinite(lineBoxArrCalc[3])) {
      xmlOut += "<span class='ocr_line' title=\"bbox " + lineBoxArrCalc[0] + " " + lineBoxArrCalc[1] + " " + lineBoxArrCalc[2] + " " + lineBoxArrCalc[3];
    } else {
      xmlOut += "<span class='ocr_line' title=\"bbox " + lineBoxArr[2] + " " + lineBoxArr[3] + " " + lineBoxArr[4] + " " + lineBoxArr[5];
    }

    xmlOut = xmlOut + "; baseline " + round6(baselineSlope) + " " + Math.round(baselinePoint);

    // Calculate character size metrics (x_size, x_ascenders, x_descenders)
    // Ideally we would be able to calculate all 3 directly, however given this is not always possible,
    // different calculations are used based on the data available.

    // If no ascenders exist on the line but x-height is known, set ascender height using the median ascender height / x-height ratio for the page so far,
    // and 1.5x the x-height as a last resort. 
    if (lineXHeight && !(lineAscHeight && (styleArr.includes("small-caps") || (lineAscHeight > lineXHeight * 1.1) && (lineAscHeight < lineXHeight * 2)))) {
      if(pageAscHeightArr.length >= 3) {
        lineAscHeight = lineXHeight * quantile(pageAscHeightArr, 0.5);
      } else {
        lineAscHeight = Math.round(lineXHeight * 1.5);
      }
    } else if(lineXHeight) {
      pageAscHeightArr.push(lineAscHeight / lineXHeight);
    }

    xmlOut = xmlOut + "; x_size " + fontSize * 0.6;
    // Add character height (misleadingly called "x_size" in Tesseract hocr)
    // TODO: Using lineAllHeight currently produces significantly oversized text for stext.  
    // Applying ad-hoc adjustment here--should be fixed to be correct in the future.
    // The core issues are:
    // (1) The bounding boxes in stext correspond to the theoretical bounding boxes of the font.
    // These are virtually always larger than the physical bounding boxes of the characters
    // (which is what calculations downstream from this think x_size represents).
    // (2) There is no "x_descenders" statistic (we cannot calculate using bounding boxes as all bounding boxes are identical for given font/font size).
    // In this case the downstream calculations assume there are no descenders, which is a good assumption for Abbyy (should not be changed altogether),
    // however leads to an even larger font size in this case. 
    // xmlOut = xmlOut + "; x_size " + Math.round(lineAllHeight * 0.4);
    // If x-height exists, calculate x_ascenders (in addition to x_descenders)
    // In general, x-height must be a plausible value (to avoid obviously misidentified characters from determining font size).
    // This restriction is not applied for lines with small caps. 
    // if (lineAscHeight && lineXHeight) {
    //   xmlOut = xmlOut + "; x_ascenders " + (lineAscHeight - lineXHeight) + "; x_descenders " + (lineAllHeight - lineAscHeight);
    //   // Otherwise, add only x_descenders
    // } else if (lineAscHeight) {
    //   xmlOut = xmlOut + "; x_descenders " + (lineAllHeight - lineAscHeight);
    // }



    xmlOut = xmlOut + "\">";

    let lettersKept = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i].trim() == "") { continue };
      let bboxesI = bboxes[i];

      const bboxesILeft = Math.min(...bboxesI.map(x => x[0]));
      const bboxesIRight = Math.max(...bboxesI.map(x => x[2]));
      const bboxesITop = Math.min(...bboxesI.map(x => x[1]));
      const bboxesIBottom = Math.max(...bboxesI.map(x => x[3]));

      xmlOut = xmlOut + "<span class='ocrx_word' id='word_" + (pageNum + 1) + "_" + (lineNum + 1) + "_" + (i + 1) + "' title='bbox " + bboxesILeft + " " + bboxesITop + " " + bboxesIRight + " " + bboxesIBottom;
      if (wordSusp[i]) {
        xmlOut = xmlOut + ";x_wconf 0";
      } else {
        xmlOut = xmlOut + ";x_wconf 100";
      }
      xmlOut = xmlOut + "\'"

      // Add "style" attribute (if applicable)
      if(["italic","small-caps"].includes(styleArr[i]) || fontFamily != "Default") {
        xmlOut = xmlOut + " style='"

        if (styleArr[i] == "italic") {
          xmlOut = xmlOut + "font-style:italic" ;
        } else if (styleArr[i] == "small-caps") {
          xmlOut = xmlOut + "font-variant:small-caps";
        } 

        if (fontFamily != "Default") {
          xmlOut = xmlOut + "font-family:" + fontFamily;
        }

        xmlOut = xmlOut + "'>"
      } else {
        xmlOut = xmlOut + ">"
      }

      // Add word text, along with any formatting that uses nested elements rather than attributes
      if (styleArr[i] == "sup") {
        xmlOut = xmlOut + "<sup>" + text[i] + "</sup>" + "</span>";
      } else if (styleArr[i] == "dropcap") {
        xmlOut = xmlOut + "<span class='ocr_dropcap'>" + text[i] + "</span>" + "</span>";
      } else {
        xmlOut = xmlOut + text[i] + "</span>";
      }

      lettersKept++;

    }

    // If there are no letters in the line, drop the entire line element
    if (lettersKept == 0) return (["", 0]);

    xmlOut = xmlOut + "</span>"
    return ([xmlOut, baselineSlope]);
  }


  let lineStrArr = xmlPage.split(/\<\/line\>/);

  let xmlOut = "<div class='ocr_page'";

  xmlOut = xmlOut + " title='bbox 0 0 " + pageDims[1] + " " + pageDims[0] + "'>";

  let angleRisePage = new Array();
  for (let i = 0; i < lineStrArr.length; i++) {
    const lineInt = convertLineStext(lineStrArr[i], i, pageNum);
    if (lineInt[0] == "") continue;
    angleRisePage.push(lineInt[1]);
    xmlOut = xmlOut + lineInt[0];
  }
  xmlOut = xmlOut + "</div>";

  let angleRiseMedian = mean50(angleRisePage) || 0;

  const angleOut = Math.asin(angleRiseMedian) * (180 / Math.PI);


  let lineLeftAdj = new Array;
  for (let i = 0; i < lineLeft.length; i++) {
    lineLeftAdj.push(lineLeft[i] + angleRiseMedian * lineTop[i]);
  }
  let leftOut = quantile(lineLeft, 0.2);
  let leftAdjOut = quantile(lineLeftAdj, 0.2) - leftOut;
  // With <5 lines either a left margin does not exist (e.g. a photo or title page) or cannot be reliably determined
  if (lineLeft.length < 5) {
    leftOut = null;
  }

  const dimsOut = pageDims;

  return ([xmlOut, dimsOut, angleOut, leftOut, leftAdjOut, fontMetricsObj, {}]);

}

function convertTableLayoutAbbyy(xmlPage) {

  // Note: This assumes that block elements are not nested within table block elements
  // Not sure if this is true or not
  const tableRegex = new RegExp(/<block blockType\=[\"\']Table[\s\S]+?(?:\<\/block\>\s*)/, "ig");

  let tables = xmlPage.match(tableRegex);

  if (!tables) return {};

  const boxes = {};

  for (let i=0; i < tables.length; i++) {
    let tableBoxes = {};

    const table = tables[i];
    const tableCoords = table.match(/<block blockType=[\'\"]Table[\'\"][^>]*?l=[\'\"](\d+)[\'\"] t=[\'\"](\d+)[\'\"] r=[\'\"](\d+)[\'\"] b=[\'\"](\d+)[\'\"]/i).slice(1, 5).map(function (x) { return parseInt(x) });

    let leftLast = tableCoords[0];

    const rows = table.match(/<row[\s\S]+?(?:\<\/row\>\s*)/g);

    // Columns widths are calculated using the cells in a single row.
    // The first row is used unless it contains cells spanning multiple columns,
    // in which case the second row is used. 
    const firstRow = rows[1] && /colSpan/.test(rows[0]) ? rows[1] : rows[0];

    const firstRowCells = firstRow.match(/<cell[\s\S]+?(?:\<\/cell\>\s*)/ig);

    for (let j=0; j < firstRowCells.length; j++) {
      const cell = firstRowCells[j];
      const cellWidth = parseInt(cell.match(/width=[\'\"](\d+)[\'\"]/)?.[1]);

      const id = getRandomAlphanum(10);

      const cellLeft = leftLast;
      const cellRight = leftLast + cellWidth;

      leftLast = cellRight;

      const priority = Object.keys(boxes).length + Object.keys(tableBoxes).length + 1;

      tableBoxes[id] = {
        priority: priority,
        coords: [cellLeft, tableCoords[1], cellRight, tableCoords[3]],
        type: "dataColumn",
        table: i,
        inclusionRule: "majority"
      };
    }

    // Abbyy sometimes provides column widths that are incorrect
    // If the column widths do not add up to the table width, the column widths are re-caculated from scratch.
    if (Math.abs(leftLast - tableCoords[2]) > 10) {

      let colLeftArr = [];
      let colRightArr = [];

      let colsWithData = 0;
      for (let j=0; j < rows.length; j++) {
        const cells = rows[j].match(/<cell[\s\S]+?(?:\<\/cell\>\s*)/ig);
        for (let k=0; k < cells.length; k++) {
          // Extract coordinates for every element in the cell with coordinates
          const coordsArrStr = cells[k].match(/l=[\'\"](\d+)[\'\"] t=[\'\"](\d+)[\'\"] r=[\'\"](\d+)[\'\"] b=[\'\"](\d+)[\'\"]/ig);
          if (!coordsArrStr) continue;
          const coordsArr = coordsArrStr.map(x => x.match(/\d+/g).map(y => parseInt(y)))
          const cellLeft = Math.min(...coordsArr.map(x => x[0]));
          const cellRight = Math.max(...coordsArr.map(x => x[2]));
          if (!colLeftArr[k]) {
            colLeftArr[k] = [];
            colRightArr[k] = [];
            colsWithData++;
          }
          colLeftArr[k].push(cellLeft);
          colRightArr[k].push(cellRight);
        }
      }

      // Columns that contain no data are removed
      colLeftArr = colLeftArr.filter(x => x);
      colRightArr = colRightArr.filter(x => x);

      // Calculate the minimum left bound of each column
      const colLeftMin = colLeftArr.map(x => Math.min(...x));
      
      // Calculate the max right bound of each column, after removing observations past the minimum left bound of the next column.
      // This filter is intended to remove cells that span multiple rows.
      const colRightMax = [];
      for (let j=0; j < colRightArr.length; j++) {
        const colRightArrJ = j + 1 == colRightArr.length ? colRightArr[j] : colRightArr[j].filter(x => x < colLeftMin[j+1]);
        colRightMax.push(Math.max(...colRightArrJ)); 
      }

      // Re-create boxes
      tableBoxes = {};
      for (let j=0; j < colLeftArr.length; j++) {

        let cellLeft;
        if (j == 0) {
          cellLeft = tableCoords[0];
        } else if (!isFinite(colRightMax[j-1])) {
          cellLeft = Math.round(colLeftMin[j]);
        } else {
          cellLeft = Math.round((colLeftMin[j] + colRightMax[j-1]) / 2);
        }

        let cellRight;
        if (j + 1 == colLeftArr.length) {
          cellRight = tableCoords[2];
        } else if (!isFinite(colRightMax[j])) {
          cellRight = colLeftMin[j+1];
        } else {
          cellRight = Math.round((colLeftMin[j+1] + colRightMax[j]) / 2);
        }
  
        const id = getRandomAlphanum(10);
  
        const priority = Object.keys(boxes).length + Object.keys(tableBoxes).length + 1;
  
        tableBoxes[id] = {
          priority: priority,
          coords: [cellLeft, tableCoords[1], cellRight, tableCoords[3]],
          type: "dataColumn",
          table: i,
          inclusionRule: "majority"
        };
      }

      console.log("Table width does not match sum of rows (" + String(tableCoords[2]) + " vs " + String(leftLast) + "), calculated new layout boxes using column contents.");

    }

    Object.assign(boxes, tableBoxes);

  }

  return boxes;

}