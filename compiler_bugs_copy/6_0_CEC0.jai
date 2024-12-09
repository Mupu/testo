
// #import,file "file.jai"()(TEST=.{});

#import,string #string DONE
#module_parameters()(
  TEST : Testo = .{}
) {
  Testo :: struct {};
}
DONE
()(TEST=.{});

main :: () {}