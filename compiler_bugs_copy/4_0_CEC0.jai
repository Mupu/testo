e :: enum {
  TEST;
  #insert "TESTO :: 5;";
  // Error: Invalid statement inside an enum. Only declarations, bare identifiers, and #if are supported.
  // Doesn't this mean that this should work?
  #insert "TESTO2;";
}

main :: () {}