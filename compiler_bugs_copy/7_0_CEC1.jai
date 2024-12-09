// This should not compile as it does not conform to the interface
// #import "EC1_#import_program_param_3"()(struct {wrong := "hi";});

#import,string #string DONE
#module_parameters()(
  // It seems the interface gets ignored! The compiler should error here
  TEST : $I/interface Testo = Testo
) {
  Testo :: struct {x: int;};
}

#run {
  crash: TEST;
  // crash.x = 5;
}
DONE
()(struct {wrong := "hi";});

main :: () {}